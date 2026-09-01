import { NextResponse } from 'next/server';
import { resetPasswordWithToken } from '@/lib/auth/password-reset';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Spends a reset link and sets the new password.
 *
 * Ends at /login rather than signing the person straight in. Sessions here are signed
 * cookies with no server-side record, so a reset cannot invalidate a session already
 * issued to somebody else — which means the honest thing this flow can promise is a
 * new password, and the person should see it work. Typing it once at the login screen
 * is that proof, and it is also how the browser gets offered the chance to save it.
 */

function back(request: Request, token: string, error: string) {
  const url = new URL('/reset-password', request.url);
  if (token) url.searchParams.set('token', token);
  url.searchParams.set('error', error);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  const token = String(form?.get('token') ?? '');
  const password = String(form?.get('password') ?? '');
  const confirm = String(form?.get('confirm') ?? '');

  if (!token) return back(request, '', 'invalid');

  // Guessing a 256-bit token is not the threat; a script hammering this endpoint with
  // a stolen-looking link still is, and the KDF below is deliberately expensive.
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';
  if (!rateLimit(`reset:ip:${ip}`, 20, 15 * 60_000).ok) {
    return back(request, token, 'throttled');
  }

  if (!password || !confirm) return back(request, token, 'missing');
  // Compared before hashing: a typo in the confirm box should cost nothing and, more
  // to the point, must not burn the token.
  if (password !== confirm) return back(request, token, 'mismatch');

  const outcome = await resetPasswordWithToken({ token, newPassword: password });

  if (outcome.status === 'weak_password') return back(request, token, 'weak');
  if (outcome.status === 'invalid') return back(request, token, outcome.reason);

  const url = new URL('/login', request.url);
  url.searchParams.set('reset', '1');
  return NextResponse.redirect(url, 303);
}
