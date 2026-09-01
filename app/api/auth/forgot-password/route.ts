import { NextResponse } from 'next/server';
import { requestPasswordReset } from '@/lib/auth/password-reset';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "Email me a reset link."
 *
 * A plain form POST for the same reason sign-in is one (see api/auth/login): this is a
 * recovery screen, and it has to work from a tab that was open across a deploy.
 *
 * The response is identical whether or not the address belongs to an account. An
 * unauthenticated form that answers "no such user" is a list of who works here,
 * readable by anyone — and the login form next to it already refuses to be that.
 */

const PER_IP_LIMIT = 10;
const PER_EMAIL_LIMIT = 3;
const WINDOW_MS = 15 * 60_000;

function done(request: Request) {
  const url = new URL('/forgot-password', request.url);
  url.searchParams.set('sent', '1');
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  const email = String(form?.get('email') ?? '')
    .trim()
    .toLowerCase();

  if (!email) {
    const url = new URL('/forgot-password', request.url);
    url.searchParams.set('error', 'missing');
    return NextResponse.redirect(url, 303);
  }

  // Two buckets. The per-IP one stops someone walking the alphabet; the per-email one
  // stops an inbox being used as a weapon against whoever owns it. Both fail closed
  // into the same "check your email" response, so neither leaks either.
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';

  const ipOk = rateLimit(`forgot:ip:${ip}`, PER_IP_LIMIT, WINDOW_MS).ok;
  const emailOk = rateLimit(`forgot:email:${email}`, PER_EMAIL_LIMIT, WINDOW_MS).ok;
  if (!ipOk || !emailOk) return done(request);

  const outcome = await requestPasswordReset({
    email,
    origin: new URL(request.url).origin,
  });

  // Logged, never shown. 'no_account' in particular must not reach the browser.
  if (outcome.status !== 'sent') {
    console.log(`[password-reset] request for ${email}: ${outcome.status}`);
  }

  return done(request);
}
