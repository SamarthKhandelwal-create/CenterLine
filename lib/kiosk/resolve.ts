import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { db as defaultDb, type Db } from '@/db';
import { credential as credentialT, student as studentT } from '@/db/schema';
import { toggleAttendance } from '@/lib/attendance/commands';
import { hashToken } from '@/lib/credentials/token';
import { sendPickupReady } from '@/lib/sms/send';
import type { CaptureMethod, Centre } from '@/db/schema';

export type KioskOutcome =
  | {
      ok: true;
      action: 'check_in' | 'check_out';
      firstName: string;
      lastInitial: string;
      occurredAt: string;
      durationMinutes: number | null;
    }
  | { ok: false };

/**
 * Applies the toggle rule for a student the kiosk has already identified, and tells
 * the guardian if it was a check-out.
 *
 * Every failure returns the same bare `{ ok: false }`. The kiosk shows one amber
 * screen for all of them — unknown card, revoked card, a card from another centre, an
 * inactive student. A child is never told why, and the response is not an oracle for
 * probing which tokens exist.
 */
async function applyToggle(
  args: {
    centre: Centre;
    studentId: string;
    firstName: string;
    lastInitial: string;
    captureMethod: CaptureMethod;
    at?: Date;
  },
  db: Db,
): Promise<KioskOutcome> {
  const result = await toggleAttendance(
    {
      studentId: args.studentId,
      centreId: args.centre.id,
      timezone: args.centre.timezone,
      captureMethod: args.captureMethod,
      at: args.at,
    },
    db,
  );

  if (result.action === 'check_out' && !result.deduplicated) {
    // Never let a messaging failure break the child's check-out.
    try {
      await sendPickupReady(
        { studentId: args.studentId, centre: args.centre, at: result.occurredAt },
        db,
      );
    } catch (err) {
      console.error('[kiosk] pickup SMS failed', err);
    }
  }

  return {
    ok: true,
    action: result.action,
    firstName: args.firstName,
    lastInitial: args.lastInitial,
    occurredAt: result.occurredAt.toISOString(),
    durationMinutes: result.durationMinutes,
  };
}

/** Resolves a scanned QR token to a student, then toggles. */
export async function resolveScanAndToggle(
  args: { centre: Centre; token: string; at?: Date },
  db: Db = defaultDb,
): Promise<KioskOutcome> {
  const rows = await db
    .select({
      studentId: credentialT.studentId,
      firstName: studentT.firstName,
      lastInitial: studentT.lastInitial,
      status: studentT.status,
    })
    .from(credentialT)
    .innerJoin(studentT, eq(studentT.id, credentialT.studentId))
    .where(
      and(
        eq(credentialT.tokenHash, hashToken(args.token)),
        eq(credentialT.kind, 'qr'),
        eq(credentialT.centreId, args.centre.id),
        isNull(credentialT.revokedAt),
      ),
    )
    .limit(1);

  const found = rows[0];
  if (!found || found.status !== 'active') return { ok: false };

  return applyToggle(
    { centre: args.centre, ...found, captureMethod: 'kiosk_qr', at: args.at },
    db,
  );
}

/**
 * Toggles a student the child picked from the on-screen name grid.
 *
 * The student id comes from the browser, so it is re-checked against this centre's
 * active roster before anything is written — the kiosk device cookie authorises the
 * tablet, not whatever id it happens to send.
 */
export async function resolveTapAndToggle(
  args: { centre: Centre; studentId: string; at?: Date },
  db: Db = defaultDb,
): Promise<KioskOutcome> {
  const rows = await db
    .select({
      studentId: studentT.id,
      firstName: studentT.firstName,
      lastInitial: studentT.lastInitial,
      status: studentT.status,
    })
    .from(studentT)
    .where(and(eq(studentT.id, args.studentId), eq(studentT.centreId, args.centre.id)))
    .limit(1);

  const found = rows[0];
  if (!found || found.status !== 'active') return { ok: false };

  return applyToggle(
    { centre: args.centre, ...found, captureMethod: 'kiosk_tap', at: args.at },
    db,
  );
}
