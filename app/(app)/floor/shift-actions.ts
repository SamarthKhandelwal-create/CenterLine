'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireSession } from '@/lib/auth/current-user';
import { clockIn, clockOut, currentShift } from '@/lib/staff/shifts';

export type ShiftState = { error?: string; ok?: boolean };

/** Starts the signed-in person's shift. Both roles clock in; this is not a permission. */
export async function clockInAction(): Promise<ShiftState> {
  const { user, centre } = await requireSession();
  await clockIn(user.id, centre.id);
  revalidatePath('/floor');
  revalidatePath('/staff');
  return { ok: true };
}

const clockOutSchema = z.object({ shiftId: z.string().uuid() });

/**
 * Ends a shift. Without a `shiftId` it ends your own, which is the Clock out button on
 * /floor. With one it ends that shift — the instructor closing a shift someone left
 * open overnight, recorded as ended by them rather than by the person who worked it.
 */
export async function clockOutAction(formData: FormData): Promise<ShiftState> {
  const { user, centre } = await requireSession();

  const raw = formData.get('shiftId');
  let shiftId: string;

  if (raw === null || raw === '') {
    const open = await currentShift(user.id);
    if (!open) return { error: 'You are not clocked in.' };
    shiftId = open.id;
  } else {
    const parsed = clockOutSchema.safeParse({ shiftId: raw });
    if (!parsed.success) return { error: 'Invalid shift.' };
    shiftId = parsed.data.shiftId;
    // Closing someone else's shift is an instructor's job.
    const open = await currentShift(user.id);
    if (open?.id !== shiftId && user.role !== 'instructor') {
      return { error: 'Only the instructor can close another person’s shift.' };
    }
  }

  const ended = await clockOut({ shiftId, centreId: centre.id, byUserId: user.id });
  revalidatePath('/floor');
  revalidatePath('/staff');
  return ended ? { ok: true } : { error: 'That shift is already closed.' };
}
