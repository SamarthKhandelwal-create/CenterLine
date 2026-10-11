import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { db as defaultDb, type Db } from '@/db';
import { student as studentT, studentSchedule } from '@/db/schema';
import { isWeekday } from './weekday';

export type ScheduleSlot = {
  weekday: number;
  /** Postgres `time` literal ("17:30:00"), or null for no fixed arrival time. */
  startsAt?: string | null;
  note?: string | null;
};

/**
 * Replaces a student's whole week in one transaction.
 *
 * Replace rather than merge because that is what the screen does: the staff member
 * sees the week, changes it and saves it, and a merge would leave a day they removed
 * still in the table. The student is re-read inside the transaction to confirm they
 * belong to this centre — without that check a crafted student id would attach a
 * schedule row to another centre's child, which the cross-centre test forbids.
 */
export async function setStudentSchedule(
  args: { centreId: string; studentId: string; slots: ScheduleSlot[] },
  db: Db = defaultDb,
): Promise<{ written: number }> {
  for (const slot of args.slots) {
    if (!isWeekday(slot.weekday)) {
      throw new Error(`${slot.weekday} is not a weekday (0-6).`);
    }
  }

  // Two slots for one day would hit the unique index as an opaque database error.
  // Catching it here names the actual problem.
  const days = args.slots.map((s) => s.weekday);
  if (new Set(days).size !== days.length) {
    throw new Error('A student can only have one schedule entry per day.');
  }

  return db.transaction(async (tx) => {
    const owned = await tx
      .select({ id: studentT.id })
      .from(studentT)
      .where(and(eq(studentT.id, args.studentId), eq(studentT.centreId, args.centreId)))
      .limit(1);
    if (owned.length === 0) {
      throw new Error('That student is not at this centre.');
    }

    await tx.delete(studentSchedule).where(eq(studentSchedule.studentId, args.studentId));

    if (args.slots.length === 0) return { written: 0 };

    await tx.insert(studentSchedule).values(
      args.slots.map((slot) => ({
        centreId: args.centreId,
        studentId: args.studentId,
        weekday: slot.weekday,
        startsAt: slot.startsAt ?? null,
        note: slot.note ?? null,
      })),
    );

    return { written: args.slots.length };
  });
}

/**
 * The days a centre actually teaches, inferred from the schedules it already has.
 *
 * Used to offer sensible days when scheduling someone new: Mason West teaches
 * Tue/Wed/Fri and Liberty Mon/Thu/Sat, and neither is written down anywhere except
 * in the pattern of its own roster. Ordered by how many students attend, so the
 * centre's real class days come first.
 */
export async function centreClassDays(
  centreId: string,
  db: Db = defaultDb,
): Promise<{ weekday: number; students: number }[]> {
  const rows = await db.execute(sql`
    SELECT weekday, count(*)::int AS students
    FROM student_schedule WHERE centre_id = ${centreId}
    GROUP BY weekday ORDER BY students DESC, weekday
  `);
  return (rows.rows as Record<string, unknown>[]).map((r) => ({
    weekday: Number(r.weekday),
    students: Number(r.students),
  }));
}

/**
 * How many students are already expected at each time on one day, so a planner can
 * see where there is room before putting another child into a slot.
 */
export async function dayLoad(
  centreId: string,
  weekday: number,
  db: Db = defaultDb,
): Promise<{ startsAt: string | null; students: number }[]> {
  const rows = await db.execute(sql`
    SELECT starts_at::text AS starts_at, count(*)::int AS students
    FROM student_schedule WHERE centre_id = ${centreId} AND weekday = ${weekday}
    GROUP BY starts_at ORDER BY starts_at NULLS LAST
  `);
  return (rows.rows as Record<string, unknown>[]).map((r) => ({
    startsAt: (r.starts_at as string | null) ?? null,
    students: Number(r.students),
  }));
}
