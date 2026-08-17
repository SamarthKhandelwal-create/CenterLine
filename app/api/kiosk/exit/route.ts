import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { KIOSK_COOKIE } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Takes this tablet out of kiosk mode by deleting the device cookie, leaving it at the
 * staff sign-in screen. Enrolling a device was always a first-class flow — a route, a
 * page, an action and a 400-day cookie — while un-enrolling had nothing at all, so a
 * browser that had once pressed "Start kiosk mode" was pinned to /kiosk until someone
 * cleared cookies by hand or rotated KIOSK_SECRET for the whole deployment.
 *
 * NOT AUTHENTICATED, deliberately: an explicit product decision to keep the way out as
 * simple as the way in. Anyone standing at the tablet, child included, can press Staff
 * and confirm. The exposure is limited to that — the handler deletes a cookie and
 * nothing else, the kiosk holds no student data beyond first names, and re-enrolling
 * takes one staff sign-in. If a centre needs it locked, `verifyPassword` in
 * lib/auth/password.ts turns this into a credential challenge without touching anything
 * else. See NOTES.md.
 *
 * A plain route handler rather than a Server Action, for the same reason as sign-out:
 * action ids are content-hashed, and this is precisely the button someone reaches for on
 * a tablet that has been sitting open across a deploy.
 */
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const jar = await cookies();
  jar.delete(KIOSK_COOKIE);
  return NextResponse.redirect(new URL('/login', request.url), 303);
}
