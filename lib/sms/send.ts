import 'server-only';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db as defaultDb, type Db } from '@/db';
import {
  guardian as guardianT,
  messageLog,
  student as studentT,
  studentGuardian,
} from '@/db/schema';
import { localHourMinute } from '@/lib/time/centre-time';
import type { Centre } from '@/db/schema';
import { getSmsProvider } from './provider';
import { notArrivedBody, pickupReadyBody, stripNonGsm } from './templates';

export const QUIET_START_HOUR = 21;
export const QUIET_END_HOUR = 8;
/** Siblings checked out inside this window share one message. */
export const SIBLING_WINDOW_MINUTES = 10;

export type SendStatus =
  | 'sent'
  | 'failed'
  | 'skipped_no_consent'
  | 'skipped_no_guardian'
  | 'skipped_quiet_hours'
  | 'suppressed_sibling';

export type SendOutcome = { status: SendStatus; body?: string; to?: string };

export function isQuietHours(at: Date, timezone: string): boolean {
  const { hour } = localHourMinute(at, timezone);
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

type PrimaryGuardian = {
  guardianId: string;
  name: string;
  phone: string;
  smsConsent: boolean;
};

async function primaryGuardianFor(studentId: string, db: Db): Promise<PrimaryGuardian | null> {
  const rows = await db
    .select({
      guardianId: guardianT.id,
      name: guardianT.name,
      phone: guardianT.phone,
      smsConsent: guardianT.smsConsent,
      isPrimary: studentGuardian.isPrimary,
    })
    .from(studentGuardian)
    .innerJoin(guardianT, eq(guardianT.id, studentGuardian.guardianId))
    .where(eq(studentGuardian.studentId, studentId))
    .orderBy(desc(studentGuardian.isPrimary));
  const row = rows[0];
  return row ? { guardianId: row.guardianId, name: row.name, phone: row.phone, smsConsent: row.smsConsent } : null;
}

async function log(
  args: {
    centreId: string;
    guardianId: string | null;
    studentId: string | null;
    template: string;
    body: string;
    status: SendStatus;
    at: Date;
  },
  db: Db,
) {
  await db.insert(messageLog).values({
    centreId: args.centreId,
    guardianId: args.guardianId,
    studentId: args.studentId,
    template: args.template,
    body: args.body,
    status: args.status,
    sentAt: args.at,
  });
}

/**
 * The consent gate. Every outbound message goes through here: no consent means no
 * send, and the decision is written to message_log either way so /compliance can
 * prove the gate is working.
 */
async function gatedSend(
  args: {
    centre: Centre;
    studentId: string | null;
    guardian: PrimaryGuardian | null;
    template: string;
    body: string;
    at: Date;
    /** Pickup messages are transactional: a guardian in the car park needs them. */
    bypassQuietHours?: boolean;
  },
  db: Db,
): Promise<SendOutcome> {
  const body = stripNonGsm(args.body);

  if (!args.guardian || !args.guardian.phone) {
    await log(
      { centreId: args.centre.id, guardianId: null, studentId: args.studentId, template: args.template, body, status: 'skipped_no_guardian', at: args.at },
      db,
    );
    return { status: 'skipped_no_guardian' };
  }

  if (!args.guardian.smsConsent) {
    await log(
      { centreId: args.centre.id, guardianId: args.guardian.guardianId, studentId: args.studentId, template: args.template, body, status: 'skipped_no_consent', at: args.at },
      db,
    );
    return { status: 'skipped_no_consent' };
  }

  if (!args.bypassQuietHours && isQuietHours(args.at, args.centre.timezone)) {
    await log(
      { centreId: args.centre.id, guardianId: args.guardian.guardianId, studentId: args.studentId, template: args.template, body, status: 'skipped_quiet_hours', at: args.at },
      db,
    );
    return { status: 'skipped_quiet_hours' };
  }

  const result = await getSmsProvider().send(args.guardian.phone, body);
  const status: SendStatus = result.status === 'sent' ? 'sent' : 'failed';
  await log(
    {
      centreId: args.centre.id,
      guardianId: args.guardian.guardianId,
      studentId: args.studentId,
      template: args.template,
      body: result.status === 'failed' ? `${body}\n[error: ${result.error}]` : body,
      status,
      at: args.at,
    },
    db,
  );
  return { status, body, to: args.guardian.phone };
}

/**
 * Pickup-ready, sent on check-out.
 *
 * Siblings: the first sibling's message sends immediately. If another child of the
 * same guardian is checked out within SIBLING_WINDOW_MINUTES, the second send is
 * suppressed rather than duplicated — recorded as 'suppressed_sibling' so /floor can
 * show that the guardian was already notified, and nothing goes silently missing.
 */
export async function sendPickupReady(
  args: { studentId: string; centre: Centre; at?: Date },
  db: Db = defaultDb,
): Promise<SendOutcome> {
  const at = args.at ?? new Date();
  const guardian = await primaryGuardianFor(args.studentId, db);
  const student = (
    await db
      .select({ firstName: studentT.firstName })
      .from(studentT)
      .where(eq(studentT.id, args.studentId))
      .limit(1)
  )[0];
  if (!student) return { status: 'skipped_no_guardian' };

  if (guardian) {
    const windowStart = new Date(at.getTime() - SIBLING_WINDOW_MINUTES * 60_000);
    const recent = await db
      .select({ id: messageLog.id })
      .from(messageLog)
      .where(
        and(
          eq(messageLog.guardianId, guardian.guardianId),
          eq(messageLog.template, 'pickup_ready'),
          eq(messageLog.status, 'sent'),
          gte(messageLog.sentAt, windowStart),
        ),
      )
      .limit(1);

    if (recent.length > 0) {
      const body = pickupReadyBody([student.firstName], args.centre.name);
      await log(
        {
          centreId: args.centre.id,
          guardianId: guardian.guardianId,
          studentId: args.studentId,
          template: 'pickup_ready',
          body,
          status: 'suppressed_sibling',
          at,
        },
        db,
      );
      return { status: 'suppressed_sibling', body };
    }
  }

  return gatedSend(
    {
      centre: args.centre,
      studentId: args.studentId,
      guardian,
      template: 'pickup_ready',
      body: pickupReadyBody([student.firstName], args.centre.name),
      at,
      bypassQuietHours: true,
    },
    db,
  );
}

/**
 * Has the not-arrived sweep already run for this centre on its local day containing `at`?
 *
 * The cron's local-hour gate is a window rather than an exact hour (see the route), so
 * this is what keeps the sweep to once per centre per day. It reads `message_log`
 * rather than tracking state of its own, and counts *any* outcome — a run that logged
 * only `skipped_no_consent` still ran, and repeating it would gain nothing.
 */
export async function notArrivedRanToday(
  centre: Centre,
  at: Date,
  db: Db = defaultDb,
): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT 1 FROM message_log
    WHERE centre_id = ${centre.id}
      AND template = 'not_arrived'
      AND (sent_at AT TIME ZONE ${centre.timezone})::date
        = (${at.toISOString()}::timestamptz AT TIME ZONE ${centre.timezone})::date
    LIMIT 1
  `);
  return rows.rows.length > 0;
}

/** Not-arrived, from the cron. Proactive, so it honours quiet hours. */
export async function sendNotArrived(
  args: { studentId: string; centre: Centre; at?: Date },
  db: Db = defaultDb,
): Promise<SendOutcome> {
  const at = args.at ?? new Date();
  const guardian = await primaryGuardianFor(args.studentId, db);
  const student = (
    await db
      .select({ firstName: studentT.firstName })
      .from(studentT)
      .where(eq(studentT.id, args.studentId))
      .limit(1)
  )[0];
  if (!student) return { status: 'skipped_no_guardian' };

  return gatedSend(
    {
      centre: args.centre,
      studentId: args.studentId,
      guardian,
      template: 'not_arrived',
      body: notArrivedBody(student.firstName, args.centre.name),
      at,
    },
    db,
  );
}

/** Free-text message from /floor. Honours consent; bypasses quiet hours (staff-initiated). */
export async function sendManualMessage(
  args: { studentId: string; centre: Centre; body: string; at?: Date },
  db: Db = defaultDb,
): Promise<SendOutcome> {
  const at = args.at ?? new Date();
  const guardian = await primaryGuardianFor(args.studentId, db);
  return gatedSend(
    {
      centre: args.centre,
      studentId: args.studentId,
      guardian,
      template: 'manual',
      body: args.body,
      at,
      bypassQuietHours: true,
    },
    db,
  );
}

/**
 * STOP handling: revokes consent for every guardian at this number, immediately.
 *
 * Matching is on the last 10 digits. A stored number may carry a country code that
 * the inbound message does not (or vice versa), and a STOP that fails to match would
 * mean continuing to text someone who asked us to stop.
 */
export async function revokeConsentByPhone(phone: string, db: Db = defaultDb): Promise<number> {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return 0;
  const suffix = digits.slice(-10);

  const rows = await db
    .update(guardianT)
    .set({ smsConsent: false, smsConsentAt: null })
    .where(
      and(
        eq(guardianT.smsConsent, true),
        sql`right(regexp_replace(${guardianT.phone}, '[^0-9]', '', 'g'), 10) = ${suffix}`,
      ),
    )
    .returning({ id: guardianT.id });
  return rows.length;
}

/** Re-grants consent on START/UNSTOP, matched the same way as STOP. */
export async function grantConsentByPhone(phone: string, at: Date, db: Db = defaultDb): Promise<number> {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return 0;
  const suffix = digits.slice(-10);

  const rows = await db
    .update(guardianT)
    .set({ smsConsent: true, smsConsentAt: at })
    .where(sql`right(regexp_replace(${guardianT.phone}, '[^0-9]', '', 'g'), 10) = ${suffix}`)
    .returning({ id: guardianT.id });
  return rows.length;
}

export async function guardiansForStudents(studentIds: string[], db: Db = defaultDb) {
  if (studentIds.length === 0) return [];
  return db
    .select({
      studentId: studentGuardian.studentId,
      guardianId: guardianT.id,
      name: guardianT.name,
      phone: guardianT.phone,
      smsConsent: guardianT.smsConsent,
      isPrimary: studentGuardian.isPrimary,
    })
    .from(studentGuardian)
    .innerJoin(guardianT, eq(guardianT.id, studentGuardian.guardianId))
    .where(inArray(studentGuardian.studentId, studentIds))
    .orderBy(desc(studentGuardian.isPrimary));
}
