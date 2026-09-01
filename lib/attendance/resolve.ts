import 'server-only';
import { sql } from 'drizzle-orm';
import { db as defaultDb, type Db } from '@/db';
import { attendanceEvent } from '@/db/schema';
import { addDays, instantFromLocal, localDateString, parseTimeOfDay } from '@/lib/time/centre-time';

export const RESOLVE_GRACE_MINUTES = 60;
export const INFERENCE_BASIS = 'no activity after close';

export type ResolveResult = {
  centreId: string;
  centreName: string;
  inserted: number;
  studentIds: string[];
};

type ResolvableCentre = { id: string; name: string; timezone: string; close_time: string };

/**
 * Closes sessions that are still open past close_time + 60 minutes, for ONE centre.
 *
 * The inserted event is capture_method 'inferred' with a stated basis. It is never
 * presented as observed: every surface that renders it shows the Estimated tag, and
 * /day offers one-tap confirmation which inserts a NEW 'staff' event superseding this
 * one. The inference itself always stays in the log.
 *
 * Idempotent: a session that already has a check-out is not open, so a second run
 * inserts nothing. That is what lets /floor call this on its refresh tick as well as
 * the nightly cron — see NOTES.md on why cron alone was not enough.
 */
export async function resolveCentreOpenSessions(
  centre: ResolvableCentre,
  at: Date = new Date(),
  db: Db = defaultDb,
): Promise<ResolveResult> {
  return resolveCentreLocalDay(centre, localDateString(at, centre.timezone), at, db);
}

/**
 * The same sweep, for an explicitly named centre-local day.
 *
 * The local day is a separate argument from `now` because the nightly cron needs to
 * close out *yesterday* using today's clock. Deriving both from one instant conflates
 * them: shifting the instant back a day to reach yesterday's date also drags the
 * `now < deadline` check back with it, so the run decides yesterday's grace period has
 * not elapsed yet and closes nothing.
 */
async function resolveCentreLocalDay(
  centre: ResolvableCentre,
  localDate: string,
  now: Date,
  db: Db,
): Promise<ResolveResult> {
  const closeAt = instantFromLocal(localDate, parseTimeOfDay(centre.close_time), centre.timezone);
  const deadline = new Date(closeAt.getTime() + RESOLVE_GRACE_MINUTES * 60_000);

  if (now.getTime() < deadline.getTime()) {
    return { centreId: centre.id, centreName: centre.name, inserted: 0, studentIds: [] };
  }

  // Students whose latest live event on the local day is a check_in.
  //
  // `occurred_at < closeAt` is load-bearing, not a tidy-up. The inferred check-out is
  // stamped at closing time, so a student checked in AFTER closing would be given a
  // departure that precedes their arrival — and because the toggle rule reads the
  // latest event by `occurred_at`, that earlier check-out never becomes the latest
  // event, so the student stays open and qualifies again on the very next run. The
  // hourly cron papered over it by only running hourly; /floor calls this every ten
  // seconds, which turned it into an unbounded insert loop against a table that has no
  // DELETE by design. A late arrival is left for staff to check out instead: inventing
  // a departure time we cannot support is the one thing this file exists to avoid.
  const open = await db.execute(sql`
    WITH today AS (
      SELECT e.*
      FROM live_attendance_event e
      WHERE e.centre_id = ${centre.id}
        AND (e.occurred_at AT TIME ZONE ${centre.timezone})::date = ${localDate}::date
    ),
    latest AS (
      SELECT DISTINCT ON (student_id) student_id, type, occurred_at
      FROM today
      ORDER BY student_id, occurred_at DESC, id DESC
    )
    SELECT student_id FROM latest
    WHERE type = 'check_in'
      AND occurred_at < ${closeAt.toISOString()}::timestamptz
  `);

  const studentIds = (open.rows as { student_id: string }[]).map((r) => r.student_id);
  if (studentIds.length > 0) {
    await db.insert(attendanceEvent).values(
      studentIds.map((studentId) => ({
        centreId: centre.id,
        studentId,
        type: 'check_out' as const,
        occurredAt: closeAt,
        captureMethod: 'inferred' as const,
        inferenceBasis: INFERENCE_BASIS,
      })),
    );
  }

  return {
    centreId: centre.id,
    centreName: centre.name,
    inserted: studentIds.length,
    studentIds,
  };
}

/** Every centre, for the local day containing `at`. */
export async function resolveOpenSessions(
  at: Date = new Date(),
  db: Db = defaultDb,
): Promise<ResolveResult[]> {
  const centres = await db.execute(sql`SELECT id, name, timezone, close_time FROM centre`);
  const results: ResolveResult[] = [];

  for (const row of centres.rows as ResolvableCentre[]) {
    results.push(await resolveCentreOpenSessions(row, at, db));
  }

  return results;
}

function mergeByCentre(runs: ResolveResult[][]): ResolveResult[] {
  const byCentre = new Map<string, ResolveResult>();
  for (const run of runs) {
    for (const result of run) {
      const seen = byCentre.get(result.centreId);
      if (seen) {
        seen.inserted += result.inserted;
        seen.studentIds.push(...result.studentIds);
      } else {
        byCentre.set(result.centreId, { ...result, studentIds: [...result.studentIds] });
      }
    }
  }
  return [...byCentre.values()];
}

/**
 * The local day containing `at`, and the one before it. This is what the cron calls.
 *
 * A single-day sweep was safe while the cron ran hourly. It is not safe daily: Vercel
 * Hobby only guarantees the job fires *within* the scheduled hour, so a run aimed at
 * local evening can land after local midnight, where a today-only sweep computes the
 * new day's close time, finds the grace period still running, and returns nothing. The
 * previous evening's open sessions would then stay open forever — /floor's ten-second
 * sweep only ever covers its own local day, so nothing else would ever pick them up.
 *
 * The extra pass is free when it is not needed: the sweep is idempotent, so a run that
 * lands where it was meant to finds yesterday already closed and inserts nothing.
 */
export async function resolveRecentOpenSessions(
  at: Date = new Date(),
  db: Db = defaultDb,
): Promise<ResolveResult[]> {
  const centres = await db.execute(sql`SELECT id, name, timezone, close_time FROM centre`);
  const runs: ResolveResult[][] = [];

  for (const centre of centres.rows as ResolvableCentre[]) {
    const today = localDateString(at, centre.timezone);
    runs.push([
      await resolveCentreLocalDay(centre, addDays(today, -1), at, db),
      await resolveCentreLocalDay(centre, today, at, db),
    ]);
  }

  return mergeByCentre(runs);
}
