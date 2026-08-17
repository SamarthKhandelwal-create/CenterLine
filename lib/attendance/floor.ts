import 'server-only';
import { closeInstantFor } from '@/lib/time/centre-time';
import { presentStudents, type PresentStudent } from './queries';
import { isOverTime } from './over-time';
import { RESOLVE_GRACE_MINUTES } from './resolve';
import { db as defaultDb, type Db } from '@/db';
import type { Centre } from '@/db/schema';

export type FloorStudent = PresentStudent & {
  elapsedMinutes: number;
  overExpected: boolean;
  pastClose: boolean;
};

export type FloorData = {
  present: FloorStudent[];
  /**
   * True once the centre is past `close_time + 60 minutes` — the moment the hourly
   * cron would close any remaining session. /floor uses it to run the same sweep
   * itself, so forgotten check-outs resolve without waiting on cron.
   */
  pastCloseGrace: boolean;
  at: Date;
};

/**
 * Everyone currently in the building, with the two flags /floor needs.
 *
 * This used to return a second `needsAttention` array that was a strict SUBSET of
 * `present`, and /floor rendered both — so an over-time student appeared twice on one
 * screen, each copy with its own working Check out button. Worse, `pastClose` is a
 * wall-clock condition rather than a per-student one, so from closing time onward the
 * two lists were identical and the board was a literal duplicate of itself.
 *
 * The over-time indicator is now derived on the client from the tick that is already
 * running, which keeps it counting up between refreshes and makes a second list
 * impossible by construction.
 */
export async function getFloorData(
  centre: Centre,
  at: Date = new Date(),
  db: Db = defaultDb,
): Promise<FloorData> {
  const present = await presentStudents(centre.id, centre.timezone, at, db);
  const closeAt = closeInstantFor(at, centre.timezone, centre.closeTime);

  const enriched: FloorStudent[] = present.map((s) => {
    const elapsedMinutes = Math.max(0, (at.getTime() - s.checkInAt.getTime()) / 60_000);
    return {
      ...s,
      elapsedMinutes,
      overExpected: isOverTime(elapsedMinutes, s.expectedMinutes),
      pastClose: at.getTime() > closeAt.getTime(),
    };
  });

  return {
    present: enriched,
    pastCloseGrace: at.getTime() > closeAt.getTime() + RESOLVE_GRACE_MINUTES * 60_000,
    at,
  };
}
