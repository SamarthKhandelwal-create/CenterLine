import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { db as defaultDb, type Db } from '@/db';
import { credential as credentialT, student as studentT } from '@/db/schema';
import { DOUBLE_SCAN_GRACE_MS, toggleAttendance } from '@/lib/attendance/commands';
import { isEarlyDeparture } from '@/lib/attendance/early-departure';
import { lastEventOnLocalDay } from '@/lib/attendance/queries';
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
      /**
       * The 20-second grace window returned the previous result instead of recording
       * anything. The kiosk must say so: a tile labelled "Check out" that answers
       * "Checked in" reads as the screen refusing to let the student leave.
       */
      repeated: boolean;
    }
  | {
      /**
       * Too early to leave. Nothing was written — this is a refusal, not a record.
       * Named so the kiosk can say "not yet" instead of showing the front-desk screen,
       * which would send a child to the desk over something the desk cannot fix.
       */
      ok: false;
      tooEarly: true;
      firstName: string;
      lastInitial: string;
    }
  | { ok: false };

/**
 * Applies the toggle rule for a student the kiosk has already identified, and tells
 * the guardian if it was a check-out.
 *
 * Every failure returns the same bare `{ ok: false }`. The kiosk shows one amber
 * screen for all of them — unknown card, revoked card, a card from another centre, an
 * inactive student. A child is never told why, and the response is not an oracle for
 * probing which tokens exist. The one exception is `tooEarly`, which is only ever reached
 * by a card that has already identified a student successfully, so it tells an attacker
 * nothing the success screen would not have told them anyway.
 */
async function applyToggle(
  args: {
    centre: Centre;
    studentId: string;
    firstName: string;
    lastInitial: string;
    expectedMinutes: number;
    captureMethod: CaptureMethod;
    at?: Date;
  },
  db: Db,
): Promise<KioskOutcome> {
  const at = args.at ?? new Date();

  if (await isTooEarlyToLeave({ ...args, at }, db)) {
    return {
      ok: false,
      tooEarly: true,
      firstName: args.firstName,
      lastInitial: args.lastInitial,
    };
  }

  const result = await toggleAttendance(
    {
      studentId: args.studentId,
      centreId: args.centre.id,
      timezone: args.centre.timezone,
      captureMethod: args.captureMethod,
      at,
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
    repeated: result.deduplicated,
  };
}

/**
 * Would this scan end a session that has not run long enough yet?
 *
 * Read before the toggle rather than inside it, so a refusal writes nothing at all: the
 * attendance log is evidence of what happened, and a check-out that was refused did not
 * happen. `toggleAttendance` stays a command that records what it is told.
 *
 * Two things are deliberately not blocked. A check-in never is — the rule is about
 * leaving. And a tap inside the double-scan grace window is left to the toggle, which
 * replays the previous result: a child who has just checked in and taps again is told
 * "Already checked in", which is both true and more useful than "not yet".
 *
 * The session is timed from the latest check-in, the same figure `toggleAttendance` uses
 * for the duration it reports, so the screen and the rule can never disagree.
 */
async function isTooEarlyToLeave(
  args: { centre: Centre; studentId: string; expectedMinutes: number; at: Date },
  db: Db,
): Promise<boolean> {
  const last = await lastEventOnLocalDay(args.studentId, args.centre.timezone, args.at, db);
  if (last?.type !== 'check_in') return false;

  const elapsedMs = args.at.getTime() - last.occurredAt.getTime();
  if (elapsedMs < DOUBLE_SCAN_GRACE_MS) return false;

  return isEarlyDeparture(Math.round(elapsedMs / 60_000), args.expectedMinutes);
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
      expectedMinutes: studentT.expectedMinutes,
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
      expectedMinutes: studentT.expectedMinutes,
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
