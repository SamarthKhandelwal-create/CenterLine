'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db';
import { requireInstructor } from '@/lib/auth/current-user';
import { centreClassDays, dayLoad, setStudentSchedule } from '@/lib/schedule/commands';
import { weekSchedule } from '@/lib/schedule/queries';
import { planSchedule } from '@/lib/schedule/plan';

const timeLiteral = z
  .string()
  .regex(/^\d{2}:\d{2}:00$/, 'A time looks like 16:30:00.');

const saveSchema = z.object({
  studentId: z.string().uuid(),
  slots: z.array(
    z.object({
      weekday: z.number().int().min(0).max(6),
      startsAt: timeLiteral.nullable(),
    }),
  ),
});

/** Saves one student's week from the schedule screen. */
export async function saveScheduleAction(input: unknown) {
  const { centre } = await requireInstructor();
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid schedule.' };

  try {
    await setStudentSchedule(
      { centreId: centre.id, studentId: parsed.data.studentId, slots: parsed.data.slots },
      db,
    );
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not save that schedule.' };
  }

  revalidatePath('/schedule');
  revalidatePath('/day');
  revalidatePath(`/students/${parsed.data.studentId}`);
  return { ok: true as const };
}

const planSchema = z.object({
  classDays: z.array(z.number().int().min(0).max(6)).min(1, 'Pick at least one class day.'),
  times: z.array(timeLiteral).min(1, 'Pick at least one arrival time.'),
  capacity: z.number().int().min(1).max(200),
});

/**
 * Builds a schedule for everyone who does not have one and returns it for review.
 *
 * Deliberately does NOT write. A generated timetable is a proposal about where real
 * children will be on a given afternoon, and it goes in front of the instructor
 * before it goes into the database.
 */
export async function previewPlanAction(input: unknown) {
  const { centre } = await requireInstructor();
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid options.' };

  const week = await weekSchedule(centre.id, db);
  if (week.unscheduled.length === 0) {
    return { error: 'Every active student already has a schedule.' };
  }

  const existingLoad = (
    await Promise.all(parsed.data.classDays.map((weekday) => dayLoad(centre.id, weekday, db)))
  ).flatMap((rows, i) =>
    rows.map((r) => ({
      weekday: parsed.data.classDays[i]!,
      startsAt: r.startsAt,
      students: r.students,
    })),
  );

  const plan = planSchedule(
    week.unscheduled.map((s) => ({
      studentId: s.studentId,
      firstName: s.firstName,
      lastInitial: s.lastInitial,
      subjects: s.subjects,
    })),
    { ...parsed.data, existingLoad },
  );

  return { ok: true as const, plan };
}

const applySchema = z.object({
  assignments: z.array(
    z.object({
      studentId: z.string().uuid(),
      slots: z.array(
        z.object({
          weekday: z.number().int().min(0).max(6),
          startsAt: timeLiteral,
        }),
      ),
    }),
  ),
});

/**
 * Writes an approved plan. Each student is written through the same command the
 * manual editor uses, so the centre check and the one-entry-per-day rule apply here
 * too — a plan cannot reach the database by a softer route than a hand edit.
 */
export async function applyPlanAction(input: unknown) {
  const { centre } = await requireInstructor();
  const parsed = applySchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid plan.' };

  let written = 0;
  for (const assignment of parsed.data.assignments) {
    try {
      await setStudentSchedule(
        { centreId: centre.id, studentId: assignment.studentId, slots: assignment.slots },
        db,
      );
      written += 1;
    } catch {
      // One bad row must not abandon the rest of the timetable; the count tells the
      // instructor how many landed.
    }
  }

  revalidatePath('/schedule');
  revalidatePath('/day');
  return { ok: true as const, written };
}

/** The days this centre already teaches, to pre-fill the planner. */
export async function suggestedClassDaysAction() {
  const { centre } = await requireInstructor();
  const days = await centreClassDays(centre.id, db);
  return { ok: true as const, days };
}
