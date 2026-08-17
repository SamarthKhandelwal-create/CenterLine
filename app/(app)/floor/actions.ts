'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { student } from '@/db/schema';
import { requireSession } from '@/lib/auth/current-user';
import { lastEventOnLocalDay } from '@/lib/attendance/queries';
import { recordEvent } from '@/lib/attendance/commands';
import { resolveCentreOpenSessions } from '@/lib/attendance/resolve';
import { sendPickupReady, sendManualMessage } from '@/lib/sms/send';

const idSchema = z.object({ studentId: z.string().uuid() });

/** One-tap check-out from the floor board. Capture method is 'staff'. */
export async function staffCheckOutAction(formData: FormData) {
  const { user, centre } = await requireSession();
  const parsed = idSchema.safeParse({ studentId: formData.get('studentId') });
  if (!parsed.success) return { error: 'Invalid student.' };

  const at = new Date();
  const last = await lastEventOnLocalDay(parsed.data.studentId, centre.timezone, at);
  if (last?.type !== 'check_in') {
    revalidatePath('/floor');
    return { error: 'That student is not currently checked in.' };
  }

  await recordEvent({
    studentId: parsed.data.studentId,
    centreId: centre.id,
    type: 'check_out',
    occurredAt: at,
    captureMethod: 'staff',
    createdBy: user.id,
  });

  await sendPickupReady({ studentId: parsed.data.studentId, centre, at });
  revalidatePath('/floor');
  revalidatePath('/day');
  return { ok: true };
}

/**
 * Checks a student in from the front desk.
 *
 * The kiosk is the normal path, but a child who has lost their card and forgotten
 * their PIN is sent to the desk by the kiosk's own error screen — so the desk has to be
 * able to finish the job. Recorded as capture_method 'staff' and attributed to whoever
 * is signed in, so it is distinguishable from a student-captured time.
 */
export async function staffCheckInAction(formData: FormData) {
  const { user, centre } = await requireSession();
  const parsed = idSchema.safeParse({ studentId: formData.get('studentId') });
  if (!parsed.success) return { error: 'Invalid student.' };

  // Confirm the student is actually on this centre's roster before writing anything.
  const rows = await db
    .select({ id: student.id, status: student.status })
    .from(student)
    .where(and(eq(student.id, parsed.data.studentId), eq(student.centreId, centre.id)))
    .limit(1);
  const found = rows[0];
  if (!found) return { error: 'That student is not on this roster.' };
  if (found.status !== 'active') return { error: 'That student is inactive.' };

  const at = new Date();
  const last = await lastEventOnLocalDay(parsed.data.studentId, centre.timezone, at);
  if (last?.type === 'check_in') {
    revalidatePath('/floor');
    return { error: 'That student is already checked in.' };
  }

  await recordEvent({
    studentId: parsed.data.studentId,
    centreId: centre.id,
    type: 'check_in',
    occurredAt: at,
    captureMethod: 'staff',
    createdBy: user.id,
  });

  revalidatePath('/floor');
  revalidatePath('/day');
  return { ok: true };
}

/**
 * Closes any session still open an hour after the centre closed, for this centre only.
 *
 * The hourly cron at /api/cron/resolve does the same thing and remains the mechanism
 * when nobody is looking. But cron never runs in local development, and on a Vercel
 * Hobby plan it is limited to once a day — so the behaviour that is supposed to make
 * forgotten check-outs resolve themselves looked, in practice, like it did not work.
 * /floor calls this on its refresh tick once past the deadline. Idempotent, so calling
 * it from several open boards at once is harmless.
 *
 * These are still 'inferred' records with the same stated basis, still tagged Estimated
 * everywhere, and still queued on /day for a staff member to confirm.
 */
export async function sweepOverdueAction() {
  const { centre } = await requireSession();

  const result = await resolveCentreOpenSessions({
    id: centre.id,
    name: centre.name,
    timezone: centre.timezone,
    close_time: centre.closeTime,
  });

  if (result.inserted > 0) {
    revalidatePath('/floor');
    revalidatePath('/day');
  }
  return { ok: true, inserted: result.inserted };
}

const messageSchema = z.object({
  studentId: z.string().uuid(),
  body: z.string().trim().min(1, 'Write a message first.').max(320, 'Keep it under 320 characters.'),
});

export type ManualMessageState = { error?: string; ok?: boolean; info?: string };

/** Free-text message to a student's primary guardian, from /floor. */
export async function sendManualMessageAction(
  _prev: ManualMessageState,
  formData: FormData,
): Promise<ManualMessageState> {
  const { centre } = await requireSession();
  const parsed = messageSchema.safeParse({
    studentId: formData.get('studentId'),
    body: formData.get('body'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the message.' };

  const result = await sendManualMessage({
    studentId: parsed.data.studentId,
    centre,
    body: parsed.data.body,
  });

  revalidatePath('/floor');
  if (result.status === 'sent') return { ok: true, info: 'Message sent.' };
  if (result.status === 'skipped_no_consent') {
    return { error: 'That guardian has not consented to SMS. Nothing was sent.' };
  }
  if (result.status === 'skipped_no_guardian') {
    return { error: 'No guardian with a phone number is on file for this student.' };
  }
  return { error: `Message not sent (${result.status}).` };
}
