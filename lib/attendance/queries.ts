import 'server-only';
import { sql } from 'drizzle-orm';
import { db as defaultDb, type Db } from '@/db';
import type { CaptureMethod, EventType } from '@/db/schema';

export type PresentStudent = {
  studentId: string;
  firstName: string;
  lastInitial: string;
  subjects: string[];
  expectedMinutes: number;
  releaseMode: 'guardian_pickup' | 'self_release';
  checkInAt: Date;
  checkInMethod: CaptureMethod;
};

/**
 * The last live event for a student on the centre-local day containing `at`.
 * This one query is the whole check-in/check-out rule: 'check_in' means a session
 * is open (so the next scan is a check-out); anything else means check-in.
 */
export async function lastEventOnLocalDay(
  studentId: string,
  timezone: string,
  at: Date = new Date(),
  db: Db = defaultDb,
): Promise<{ id: string; type: EventType; occurredAt: Date } | null> {
  const rows = await db.execute(sql`
    SELECT e.id, e.type, e.occurred_at
    FROM live_attendance_event e
    WHERE e.student_id = ${studentId}
      AND (e.occurred_at AT TIME ZONE ${timezone})::date
        = (${at.toISOString()}::timestamptz AT TIME ZONE ${timezone})::date
    ORDER BY e.occurred_at DESC, e.id DESC
    LIMIT 1
  `);
  const row = rows.rows[0] as { id: string; type: EventType; occurred_at: string } | undefined;
  return row ? { id: row.id, type: row.type, occurredAt: new Date(row.occurred_at) } : null;
}

/** Students with an open session right now, longest-present first. */
export async function presentStudents(
  centreId: string,
  timezone: string,
  at: Date = new Date(),
  db: Db = defaultDb,
): Promise<PresentStudent[]> {
  const rows = await db.execute(sql`
    WITH today AS (
      SELECT e.*
      FROM live_attendance_event e
      WHERE e.centre_id = ${centreId}
        AND (e.occurred_at AT TIME ZONE ${timezone})::date
          = (${at.toISOString()}::timestamptz AT TIME ZONE ${timezone})::date
    ),
    latest AS (
      SELECT DISTINCT ON (student_id)
        student_id, type, occurred_at, capture_method
      FROM today
      ORDER BY student_id, occurred_at DESC, id DESC
    ),
    -- A student who scans twice starts ONE session. Without this the timer would
    -- restart from the second tap and under-report how long they have been here.
    session_start AS (
      SELECT t.student_id, MIN(t.occurred_at) AS started_at
      FROM today t
      JOIN latest l ON l.student_id = t.student_id
      WHERE l.type = 'check_in'
        AND t.type = 'check_in'
        AND t.occurred_at > COALESCE(
          (SELECT MAX(o.occurred_at) FROM today o
            WHERE o.student_id = t.student_id AND o.type = 'check_out'),
          '-infinity'::timestamptz
        )
      GROUP BY t.student_id
    )
    SELECT
      s.id            AS student_id,
      s.first_name,
      s.last_initial,
      s.subjects,
      s.expected_minutes,
      s.release_mode,
      ss.started_at   AS check_in_at,
      l.capture_method
    FROM latest l
    JOIN session_start ss ON ss.student_id = l.student_id
    JOIN student s ON s.id = l.student_id
    WHERE l.type = 'check_in'
    ORDER BY ss.started_at ASC
  `);

  return (rows.rows as Record<string, unknown>[]).map((r) => ({
    studentId: r.student_id as string,
    firstName: r.first_name as string,
    lastInitial: r.last_initial as string,
    subjects: (r.subjects as string[] | null) ?? [],
    expectedMinutes: Number(r.expected_minutes),
    releaseMode: r.release_mode as PresentStudent['releaseMode'],
    checkInAt: new Date(r.check_in_at as string),
    checkInMethod: r.capture_method as CaptureMethod,
  }));
}

export type SessionRow = {
  studentId: string;
  checkOutId: string | null;
  firstName: string;
  lastInitial: string;
  sessionDate: string;
  checkInAt: Date;
  checkInMethod: CaptureMethod;
  checkOutAt: Date | null;
  checkOutMethod: CaptureMethod | null;
  checkOutBasis: string | null;
  checkOutConfirmedAt: Date | null;
  isOpen: boolean;
  isEstimated: boolean;
  durationMinutes: number | null;
};

function mapSession(r: Record<string, unknown>): SessionRow {
  return {
    studentId: r.student_id as string,
    checkOutId: (r.check_out_id as string | null) ?? null,
    firstName: r.first_name as string,
    lastInitial: r.last_initial as string,
    sessionDate: r.session_date as string,
    checkInAt: new Date(r.check_in_at as string),
    checkInMethod: r.check_in_method as CaptureMethod,
    checkOutAt: r.check_out_at ? new Date(r.check_out_at as string) : null,
    checkOutMethod: (r.check_out_method as CaptureMethod | null) ?? null,
    checkOutBasis: (r.check_out_basis as string | null) ?? null,
    checkOutConfirmedAt: r.check_out_confirmed_at ? new Date(r.check_out_confirmed_at as string) : null,
    isOpen: Boolean(r.is_open),
    isEstimated: Boolean(r.is_estimated),
    durationMinutes: r.duration_minutes === null ? null : Number(r.duration_minutes),
  };
}

/** Paired sessions over an inclusive centre-local date range, for /history. */
export async function sessionsInRange(
  centreId: string,
  from: string,
  to: string,
  opts: { studentId?: string } = {},
  db: Db = defaultDb,
): Promise<SessionRow[]> {
  const studentFilter = opts.studentId
    ? sql`AND v.student_id = ${opts.studentId}`
    : sql``;
  const rows = await db.execute(sql`
    SELECT v.*, s.first_name, s.last_initial
    FROM session_v v
    JOIN student s ON s.id = v.student_id
    WHERE v.centre_id = ${centreId}
      AND v.session_date >= ${from}::date
      AND v.session_date <= ${to}::date
      ${studentFilter}
    ORDER BY v.session_date DESC, v.check_in_at DESC
  `);
  return (rows.rows as Record<string, unknown>[]).map(mapSession);
}

/**
 * Sessions whose check-out was inferred and never reviewed by staff.
 *
 * Deliberately not limited to today. An estimate left unconfirmed keeps Kumon
 * requirement 3 ("entries reflect actual arrival and departure") in breach, so the
 * Day screen has to be able to clear a backlog, not just the current day.
 */
export async function unconfirmedInferredSessions(
  centreId: string,
  timezone: string,
  at: Date = new Date(),
  db: Db = defaultDb,
  opts: { sinceDays?: number } = {},
): Promise<SessionRow[]> {
  const sinceDays = opts.sinceDays ?? 400;
  const rows = await db.execute(sql`
    SELECT v.*, s.first_name, s.last_initial
    FROM session_v v
    JOIN student s ON s.id = v.student_id
    WHERE v.centre_id = ${centreId}
      AND v.check_out_method = 'inferred'
      AND v.session_date > (${at.toISOString()}::timestamptz AT TIME ZONE ${timezone})::date
                            - ${sinceDays}::int
      AND v.session_date <= (${at.toISOString()}::timestamptz AT TIME ZONE ${timezone})::date
    ORDER BY v.session_date DESC, v.check_in_at ASC
  `);
  return (rows.rows as Record<string, unknown>[]).map(mapSession);
}

/**
 * Minutes a student has already spent inside today, summed across every CLOSED session
 * on the centre-local day.
 *
 * Open sessions are excluded on purpose. This figure exists to decide whether a student
 * may check in again, which is a question only ever asked when they are currently out —
 * and counting a session that has not ended would mean counting minutes that are still
 * being spent.
 *
 * Inferred check-outs count like any other. The estimate is the centre's best record of
 * when the child left, and declining to count it would let an unreviewed day quietly
 * reopen the door.
 */
export async function minutesUsedToday(
  studentId: string,
  timezone: string,
  at: Date = new Date(),
  db: Db = defaultDb,
): Promise<number> {
  const rows = await db.execute(sql`
    SELECT COALESCE(SUM(v.duration_minutes), 0)::int AS used
    FROM session_v v
    WHERE v.student_id = ${studentId}
      AND v.is_open = false
      AND v.session_date
        = (${at.toISOString()}::timestamptz AT TIME ZONE ${timezone})::date
  `);
  return Number((rows.rows[0] as { used: number }).used);
}

/**
 * The same figure as `minutesUsedToday`, for every student at a centre who has closed at
 * least one session today. One query for a whole board rather than one per student.
 *
 * Students absent all day are simply missing from the map; callers read a miss as zero,
 * which is what it means.
 */
export async function minutesUsedTodayByStudent(
  centreId: string,
  timezone: string,
  at: Date = new Date(),
  db: Db = defaultDb,
): Promise<Map<string, number>> {
  const rows = await db.execute(sql`
    SELECT v.student_id, COALESCE(SUM(v.duration_minutes), 0)::int AS used
    FROM session_v v
    WHERE v.centre_id = ${centreId}
      AND v.is_open = false
      AND v.session_date
        = (${at.toISOString()}::timestamptz AT TIME ZONE ${timezone})::date
    GROUP BY v.student_id
  `);
  return new Map(
    (rows.rows as { student_id: string; used: number }[]).map((r) => [
      r.student_id,
      Number(r.used),
    ]),
  );
}

/** Active students with no live event at all on the local day. */
export async function absentStudents(
  centreId: string,
  timezone: string,
  at: Date = new Date(),
  db: Db = defaultDb,
): Promise<{ studentId: string; firstName: string; lastInitial: string; subjects: string[] }[]> {
  const rows = await db.execute(sql`
    SELECT s.id AS student_id, s.first_name, s.last_initial, s.subjects
    FROM student s
    WHERE s.centre_id = ${centreId}
      AND s.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM live_attendance_event e
        WHERE e.student_id = s.id
          AND (e.occurred_at AT TIME ZONE ${timezone})::date
            = (${at.toISOString()}::timestamptz AT TIME ZONE ${timezone})::date
      )
    ORDER BY s.first_name, s.last_initial
  `);
  return (rows.rows as Record<string, unknown>[]).map((r) => ({
    studentId: r.student_id as string,
    firstName: r.first_name as string,
    lastInitial: r.last_initial as string,
    subjects: (r.subjects as string[] | null) ?? [],
  }));
}
