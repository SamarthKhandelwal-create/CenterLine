import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db as defaultDb, type Db } from '@/db';
import { user as userT } from '@/db/schema';
import { clockIn, clockOut, currentShift } from '@/lib/staff/shifts';
import type { Centre } from '@/db/schema';

export type StaffShiftOutcome =
  | {
      ok: true;
      action: 'clock_in' | 'clock_out';
      name: string;
      occurredAt: string;
      /** The length of the shift just ended; null on a clock in. */
      durationMinutes: number | null;
    }
  | { ok: false };

/**
 * The staff equivalent of `resolveTapAndToggle`: one tap, and the system works out
 * whether this is the start or the end of a shift.
 *
 * The user id arrives from a browser holding only a device cookie, so it is re-checked
 * against this centre's staff before anything is written — the cookie authorises the
 * tablet, not whatever id it happens to send. A tap for somebody at another centre is
 * refused with the same bare `{ ok: false }` as any other failure.
 *
 * `endedBy` is set to the person themselves, so a shift closed at the kiosk is not
 * reported on /staff as having been closed by somebody else.
 */
export async function toggleStaffShift(
  args: { centre: Centre; userId: string; at?: Date },
  db: Db = defaultDb,
): Promise<StaffShiftOutcome> {
  const rows = await db
    .select({ id: userT.id, name: userT.name })
    .from(userT)
    .where(and(eq(userT.id, args.userId), eq(userT.centreId, args.centre.id)))
    .limit(1);

  const found = rows[0];
  if (!found) return { ok: false };

  const at = args.at ?? new Date();
  const open = await currentShift(found.id, db);

  if (open) {
    const ended = await clockOut(
      { shiftId: open.id, centreId: args.centre.id, byUserId: found.id, at },
      db,
    );
    // Lost a race against another tablet: the shift is already closed, and saying so
    // is more honest than reporting a clock-out this tap did not perform.
    if (!ended) return { ok: false };

    return {
      ok: true,
      action: 'clock_out',
      name: found.name,
      occurredAt: at.toISOString(),
      durationMinutes: Math.max(0, Math.round((at.getTime() - open.startedAt.getTime()) / 60_000)),
    };
  }

  // clockIn hands back the existing shift if one appeared in between, so the time on
  // screen is the time actually recorded rather than the time of the tap.
  const shift = await clockIn(found.id, args.centre.id, at, db);
  return {
    ok: true,
    action: 'clock_in',
    name: found.name,
    occurredAt: shift.startedAt.toISOString(),
    durationMinutes: null,
  };
}
