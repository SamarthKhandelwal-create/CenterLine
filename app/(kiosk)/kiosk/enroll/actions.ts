'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireSession } from '@/lib/auth/current-user';
import { KIOSK_COOKIE, createKioskToken } from '@/lib/auth/session';
import { env } from '@/lib/env';

const schema = z.object({ label: z.string().trim().min(1).max(60).default('Front door') });

/**
 * Binds this tablet to the centre. Run once per device by a signed-in staff member;
 * afterwards the tablet holds only a device cookie, never a staff session.
 */
export async function enrollKioskAction(formData: FormData) {
  const { centre } = await requireSession();
  const parsed = schema.safeParse({ label: formData.get('label') || 'Front door' });
  const label = parsed.success ? parsed.data.label : 'Front door';

  const token = await createKioskToken(centre.id, label, env.KIOSK_SECRET);
  const jar = await cookies();
  jar.set(KIOSK_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 400,
  });
  redirect('/kiosk');
}
