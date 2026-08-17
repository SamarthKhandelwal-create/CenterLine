'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { attendanceEvent } from '@/db/schema';
import { requireSession } from '@/lib/auth/current-user';
import { confirmInferredCheckOut } from '@/lib/attendance/commands';

const schema = z.object({ eventId: z.string().uuid() });

/**
 * Confirms one estimated check-out. Inserts a NEW event with capture_method 'staff'
 * and confirmed_by set, superseding that specific inference. The inferred row stays
 * in the log forever — that is the compliance requirement, and it is what lets an
 * auditor see both what the system guessed and what a human confirmed.
 *
 * Targets the event by id rather than "the student's latest estimate": with a backlog
 * of unreviewed days, confirming a row would otherwise attest to the wrong record.
 */
export async function confirmInferredAction(formData: FormData) {
  const { user, centre } = await requireSession();
  const parsed = schema.safeParse({ eventId: formData.get('eventId') });
  if (!parsed.success) return { error: 'Invalid record.' };

  const rows = await db
    .select({
      id: attendanceEvent.id,
      studentId: attendanceEvent.studentId,
      occurredAt: attendanceEvent.occurredAt,
    })
    .from(attendanceEvent)
    .where(
      and(
        eq(attendanceEvent.id, parsed.data.eventId),
        eq(attendanceEvent.centreId, centre.id),
        eq(attendanceEvent.captureMethod, 'inferred'),
        // Not already confirmed by someone else.
        sql`NOT EXISTS (SELECT 1 FROM attendance_event s WHERE s.supersedes_id = ${attendanceEvent.id})`,
      ),
    )
    .limit(1);

  const inferred = rows[0];
  if (!inferred) return { error: 'That estimate has already been confirmed.' };

  await confirmInferredCheckOut({
    inferredEventId: inferred.id,
    centreId: centre.id,
    studentId: inferred.studentId,
    occurredAt: inferred.occurredAt,
    confirmedBy: user.id,
  });

  revalidatePath('/day');
  revalidatePath('/history');
  revalidatePath('/compliance');
  return { ok: true };
}
