/**
 * Building a schedule for students who do not have one.
 *
 * A plain module — no database, no 'server-only' — so the whole assignment is a pure
 * function of its inputs and can be tested without a centre. The caller reads the
 * current state, calls `planSchedule`, shows the result for approval, and only then
 * writes it. Nothing here writes anything.
 */

export type PlanStudent = {
  studentId: string;
  firstName: string;
  lastInitial: string;
  /** Drives how many days a week they are offered: two subjects, two sessions. */
  subjects: string[];
};

export type PlanSlot = { weekday: number; startsAt: string };

export type PlanAssignment = {
  studentId: string;
  firstName: string;
  lastInitial: string;
  slots: PlanSlot[];
};

export type PlanResult = {
  assignments: PlanAssignment[];
  /** Students the planner could not place, with the reason. */
  unplaced: { studentId: string; firstName: string; lastInitial: string; reason: string }[];
  /** Resulting head count per day and time, existing load included. */
  load: { weekday: number; startsAt: string; students: number; capacity: number }[];
};

export type PlanOptions = {
  /** The days this centre teaches, e.g. [2, 3, 5] for Mason West. */
  classDays: number[];
  /** Arrival times a student may be given, as Postgres time literals. */
  times: string[];
  /** How many students may be expected at one day and time. */
  capacity: number;
  /** Day+time counts that already exist and must be respected. */
  existingLoad?: { weekday: number; startsAt: string | null; students: number }[];
  /** Sessions per week. Default: one per subject, at least one, capped by class days. */
  sessionsFor?: (student: PlanStudent) => number;
};

function defaultSessionsFor(student: PlanStudent): number {
  return Math.max(1, student.subjects.length);
}

/**
 * Assigns students to day/time slots, filling the emptiest slot first.
 *
 * Least-loaded-first is what keeps the room even: assigning in roster order would
 * pack Monday 4pm to capacity before touching Monday 4:30, which is the opposite of
 * how a centre actually runs. Ties break by earlier day then earlier time so the
 * result is deterministic — the same input gives the same plan every time, which is
 * what makes it reviewable and testable.
 *
 * A student is never given the same weekday twice: the schema forbids it, and two
 * sessions on one day is not what "twice a week" means.
 */
export function planSchedule(students: PlanStudent[], options: PlanOptions): PlanResult {
  const { classDays, times, capacity } = options;
  const sessionsFor = options.sessionsFor ?? defaultSessionsFor;

  const assignments: PlanAssignment[] = [];
  const unplaced: PlanResult['unplaced'] = [];

  if (classDays.length === 0 || times.length === 0 || capacity <= 0) {
    return {
      assignments: [],
      unplaced: students.map((s) => ({
        studentId: s.studentId,
        firstName: s.firstName,
        lastInitial: s.lastInitial,
        reason:
          capacity <= 0
            ? 'Capacity per slot must be at least 1.'
            : 'The centre has no class days or times to schedule into.',
      })),
      load: [],
    };
  }

  // Current head count for every slot the planner may use. Existing rows with no
  // fixed time occupy no slot: they are expectations without a place in the grid.
  const counts = new Map<string, number>();
  const key = (weekday: number, startsAt: string) => `${weekday}|${startsAt}`;
  for (const day of classDays) for (const t of times) counts.set(key(day, t), 0);
  for (const row of options.existingLoad ?? []) {
    if (row.startsAt === null) continue;
    const k = key(row.weekday, row.startsAt);
    if (counts.has(k)) counts.set(k, (counts.get(k) ?? 0) + row.students);
  }

  // Stable student order, so the plan does not depend on the order rows came back in.
  const ordered = [...students].sort(
    (a, b) =>
      a.firstName.localeCompare(b.firstName) ||
      a.lastInitial.localeCompare(b.lastInitial) ||
      a.studentId.localeCompare(b.studentId),
  );

  for (const student of ordered) {
    const wanted = Math.min(sessionsFor(student), classDays.length);
    const slots: PlanSlot[] = [];
    const usedDays = new Set<number>();

    for (let i = 0; i < wanted; i += 1) {
      let best: { weekday: number; startsAt: string; count: number } | null = null;

      for (const weekday of classDays) {
        if (usedDays.has(weekday)) continue;
        for (const startsAt of times) {
          const count = counts.get(key(weekday, startsAt)) ?? 0;
          if (count >= capacity) continue;
          if (
            best === null ||
            count < best.count ||
            (count === best.count && weekday < best.weekday) ||
            (count === best.count && weekday === best.weekday && startsAt < best.startsAt)
          ) {
            best = { weekday, startsAt, count };
          }
        }
      }

      if (!best) break;
      slots.push({ weekday: best.weekday, startsAt: best.startsAt });
      usedDays.add(best.weekday);
      counts.set(key(best.weekday, best.startsAt), best.count + 1);
    }

    if (slots.length === 0) {
      unplaced.push({
        studentId: student.studentId,
        firstName: student.firstName,
        lastInitial: student.lastInitial,
        reason: 'Every slot is full.',
      });
      continue;
    }

    // Partial placement is still worth having, but it must not pass silently as a
    // full one: the caller shows the shortfall next to the student.
    if (slots.length < wanted) {
      unplaced.push({
        studentId: student.studentId,
        firstName: student.firstName,
        lastInitial: student.lastInitial,
        reason: `Only ${slots.length} of ${wanted} sessions could be placed; the rest of the week is full.`,
      });
    }

    slots.sort((a, b) => a.weekday - b.weekday || a.startsAt.localeCompare(b.startsAt));
    assignments.push({
      studentId: student.studentId,
      firstName: student.firstName,
      lastInitial: student.lastInitial,
      slots,
    });
  }

  const load: PlanResult['load'] = [];
  for (const weekday of classDays) {
    for (const startsAt of times) {
      load.push({
        weekday,
        startsAt,
        students: counts.get(key(weekday, startsAt)) ?? 0,
        capacity,
      });
    }
  }

  return { assignments, unplaced, load };
}
