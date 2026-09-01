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
 *
 * The enroller's role goes into the token because it decides what the tablet offers:
 * the staff clock in / out panel appears only on a device an instructor set up. Nothing
 * else reads it, and it is a role, not an identity — the token still names no person.
 */
export async function enrollKioskAction(formData: FormData) {
  const { user, centre } = await requireSession();
  const parsed = schema.safeParse({ label: formData.get('label') || 'Front door' });
  const label = parsed.success ? parsed.data.label : 'Front door';

  const token = await createKioskToken(centre.id, label, env.KIOSK_SECRET, user.role);
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
