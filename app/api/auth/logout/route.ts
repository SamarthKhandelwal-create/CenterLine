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
  return NextResponse.redirect(new URL('/login', request.url), 303);
}
