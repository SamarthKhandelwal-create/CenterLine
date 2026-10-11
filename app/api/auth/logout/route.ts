import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Sign-out, for the same reason as sign-in: it must survive a stale tab. */
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);

  // Signing out of a borrowed door tablet should land back on its kiosk, not on a
  // login screen nobody at the door can use. Same-origin paths only, so the form
  // cannot be used to bounce someone off site.
  const form = await request.formData().catch(() => null);
  const next = form?.get('next');
  const target =
    typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/login';

  return NextResponse.redirect(new URL(target, request.url), 303);
}
