import 'server-only';
import { sql } from 'drizzle-orm';
import { db as defaultDb, type Db } from '@/db';
import { localWeekday } from './weekday';

export type ScheduleEntry = {
  id: string;
  studentId: string;
  weekday: number;
  startsAt: string | null;
  note: string | null;
};

export type ExpectedStudent = {
  studentId: string;
  firstName: string;
  lastInitial: string;
  subjects: string[];
  /** Centre-local wall clock, or null for a day with no fixed arrival time. */
  startsAt: string | null;
  note: string | null;
  /** Whether they have been seen in the building today. */
  arrived: boolean;
};

/**
 * Everyone expected at the centre on the local day containing `at`.
 *
 * The weekday is computed in the CENTRE's timezone, not the server's: on Vercel (UTC)
 * a Saturday evening in New York is already Sunday, which would empty a Saturday
 * roster. `arrived` is a check against today's events, so the caller can split
 * expected-and-here from expected-and-missing without a second query.
 */
export async function expectedToday(
  centreId: string,
  timezone: string,
  at: Date = new Date(),
  db: Db = defaultDb,
): Promise<ExpectedStudent[]> {
  const weekday = localWeekday(at, timezone);

  const rows = await db.execute(sql`
    SELECT s.id AS student_id, s.first_name, s.last_initial, s.subjects,
           sch.starts_at::text AS starts_at, sch.note,
           EXISTS (
             SELECT 1 FROM live_attendance_event e
             WHERE e.student_id = s.id
               AND (e.occurred_at AT TIME ZONE ${timezone})::date
                 = (${at.toISOString()}::timestamptz AT TIME ZONE ${timezone})::date
           ) AS arrived
    FROM student_schedule sch
    JOIN student s ON s.id = sch.student_id
    WHERE sch.centre_id = ${centreId}
      AND sch.weekday = ${weekday}
      AND s.status = 'active'
    ORDER BY sch.starts_at NULLS LAST, s.first_name, s.last_initial
  `);

  return (rows.rows as Record<string, unknown>[]).map((r) => ({
    studentId: r.student_id as string,
    firstName: r.first_name as string,
    lastInitial: r.last_initial as string,
    subjects: (r.subjects as string[] | null) ?? [],
    startsAt: (r.starts_at as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    arrived: r.arrived === true,
  }));
}

/**
 * The whole week for one centre, for the schedule screen.
 *
 * Students with no schedule at all are returned under `unscheduled` rather than
 * omitted: they are the ones needing attention, so leaving them off the screen that
 * exists to fix them would hide the problem.
 */
export async function weekSchedule(
  centreId: string,
  db: Db = defaultDb,
): Promise<{
  byWeekday: Record<number, ExpectedStudent[]>;
  unscheduled: { studentId: string; firstName: string; lastInitial: string; subjects: string[] }[];
}> {
  const rows = await db.execute(sql`
    SELECT s.id AS student_id, s.first_name, s.last_initial, s.subjects,
           sch.weekday, sch.starts_at::text AS starts_at, sch.note
    FROM student_schedule sch
    JOIN student s ON s.id = sch.student_id
    WHERE sch.centre_id = ${centreId} AND s.status = 'active'
    ORDER BY sch.weekday, sch.starts_at NULLS LAST, s.first_name, s.last_initial
  `);

  const byWeekday: Record<number, ExpectedStudent[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const r of rows.rows as Record<string, unknown>[]) {
    const weekday = Number(r.weekday);
    (byWeekday[weekday] ??= []).push({
      studentId: r.student_id as string,
      firstName: r.first_name as string,
      lastInitial: r.last_initial as string,
      subjects: (r.subjects as string[] | null) ?? [],
      startsAt: (r.starts_at as string | null) ?? null,
      note: (r.note as string | null) ?? null,
      arrived: false,
    });
  }

  const none = await db.execute(sql`
    SELECT s.id AS student_id, s.first_name, s.last_initial, s.subjects
    FROM student s
    WHERE s.centre_id = ${centreId}
      AND s.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM student_schedule sch WHERE sch.student_id = s.id)
    ORDER BY s.first_name, s.last_initial
  `);

  return {
    byWeekday,
    unscheduled: (none.rows as Record<string, unknown>[]).map((r) => ({
      studentId: r.student_id as string,
      firstName: r.first_name as string,
      lastInitial: r.last_initial as string,
      subjects: (r.subjects as string[] | null) ?? [],
    })),
  };
}

/**
 * Schedule rows that need a human to look at them: a day with no arrival time, or a
 * note the import could not read as one ("Flex/Monthly"). The answer to "import it,
 * flag it for review" — the data is kept exactly as the roster had it, and this is
 * how staff find the gaps.
 */
export async function schedulesNeedingReview(
  centreId: string,
  db: Db = defaultDb,
): Promise<{ studentId: string; firstName: string; lastInitial: string; weekday: number; note: string | null }[]> {
  const rows = await db.execute(sql`
    SELECT s.id AS student_id, s.first_name, s.last_initial, sch.weekday, sch.note
    FROM student_schedule sch
    JOIN student s ON s.id = sch.student_id
    WHERE sch.centre_id = ${centreId}
      AND s.status = 'active'
      AND sch.starts_at IS NULL
    ORDER BY s.first_name, s.last_initial, sch.weekday
  `);
  return (rows.rows as Record<string, unknown>[]).map((r) => ({
    studentId: r.student_id as string,
    firstName: r.first_name as string,
    lastInitial: r.last_initial as string,
    weekday: Number(r.weekday),
    note: (r.note as string | null) ?? null,
  }));
}

/** One student's week, for their detail page. */
export async function scheduleForStudent(
  studentId: string,
  db: Db = defaultDb,
): Promise<ScheduleEntry[]> {
  const rows = await db.execute(sql`
    SELECT id, student_id, weekday, starts_at::text AS starts_at, note
    FROM student_schedule WHERE student_id = ${studentId} ORDER BY weekday
  `);
  return (rows.rows as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    studentId: r.student_id as string,
    weekday: Number(r.weekday),
    startsAt: (r.starts_at as string | null) ?? null,
    note: (r.note as string | null) ?? null,
  }));
}
