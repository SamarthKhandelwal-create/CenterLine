import 'server-only';
import { sql } from 'drizzle-orm';
import { db as defaultDb, type Db } from '@/db';
import { attendanceEvent } from '@/db/schema';
import { closeInstantFor } from '@/lib/time/centre-time';

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
 * the hourly cron — see NOTES.md on why cron alone was not enough.
 */
export async function resolveCentreOpenSessions(
  centre: ResolvableCentre,
  at: Date = new Date(),
  db: Db = defaultDb,
): Promise<ResolveResult> {
  const closeAt = closeInstantFor(at, centre.timezone, centre.close_time);
  const deadline = new Date(closeAt.getTime() + RESOLVE_GRACE_MINUTES * 60_000);

  if (at.getTime() < deadline.getTime()) {
    return { centreId: centre.id, centreName: centre.name, inserted: 0, studentIds: [] };
  }

  // Students whose latest live event on the local day is a check_in.
  const open = await db.execute(sql`
    WITH today AS (
      SELECT e.*
      FROM live_attendance_event e
      WHERE e.centre_id = ${centre.id}
        AND (e.occurred_at AT TIME ZONE ${centre.timezone})::date
          = (${at.toISOString()}::timestamptz AT TIME ZONE ${centre.timezone})::date
    ),
    latest AS (
      SELECT DISTINCT ON (student_id) student_id, type, occurred_at
      FROM today
      ORDER BY student_id, occurred_at DESC, id DESC
    )
    SELECT student_id FROM latest WHERE type = 'check_in'
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

/** Every centre. This is what the hourly cron calls. */
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
