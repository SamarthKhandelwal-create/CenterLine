import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { centre as centreT, user as userT } from '@/db/schema';
import { env } from '@/lib/env';
import { KIOSK_COOKIE, SESSION_COOKIE, readKioskToken, readSessionToken } from './session';
import type { Centre, User, UserRole } from '@/db/schema';

export type Session = { user: User; centre: Centre };

/**
 * Reads the signed cookie, then re-reads the user from the database. Middleware
 * trusts the cookie for routing; every mutation calls this, so a role change or a
 * deleted user takes effect on the next write regardless of cookie contents.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const jar = await cookies();
  const claims = await readSessionToken(jar.get(SESSION_COOKIE)?.value, env.SESSION_SECRET);
  if (!claims) return null;

  const rows = await db
    .select({ user: userT, centre: centreT })
    .from(userT)
    .innerJoin(centreT, eq(centreT.id, userT.centreId))
    .where(eq(userT.id, claims.uid))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return { user: row.user, centre: row.centre };
});

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}

export async function requireInstructor(): Promise<Session> {
  const session = await requireSession();
  if (session.user.role !== 'instructor') redirect('/floor');
  return session;
}

export type KioskDevice = {
  centre: Centre;
  label: string;
  /**
   * The role of whoever enrolled the tablet. Null on devices enrolled before the token
   * carried it. Staff clocking is offered only where this is `instructor`, so a tablet
   * an assistant set up runs the student screen and nothing else.
   */
  enrolledByRole: UserRole | null;
};

/** The kiosk is authorised by a device cookie, never by a staff login. */
export const getKioskDevice = cache(async (): Promise<KioskDevice | null> => {
  const jar = await cookies();
  const claims = await readKioskToken(jar.get(KIOSK_COOKIE)?.value, env.KIOSK_SECRET);
  if (!claims) return null;
  const rows = await db.select().from(centreT).where(eq(centreT.id, claims.cid)).limit(1);
  const centre = rows[0];
  if (!centre) return null;
  return { centre, label: claims.label, enrolledByRole: claims.role ?? null };
});

export async function getKioskCentre(): Promise<Centre | null> {
  return (await getKioskDevice())?.centre ?? null;
}
