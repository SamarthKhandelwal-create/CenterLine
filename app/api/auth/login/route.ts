import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { signIn } from '@/lib/auth/sign-in';
import { SESSION_COOKIE, SESSION_MAX_AGE, createSessionToken } from '@/lib/auth/session';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sign-in is a plain form POST to a route handler, not a Server Action.
 *
 * Server Action ids are content-hashed, so a browser tab left open across a deploy
 * posts an id the new server does not recognise and React throws a client-side
 * exception. Signing in is the one screen that must work from a stale tab — it is how
 * someone recovers — so it deliberately avoids that mechanism, and works with
 * JavaScript disabled as a side effect.
 */
function back(request: Request, params: Record<string, string>) {
  const url = new URL('/login', request.url);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  return NextResponse.redirect(url, 303);
}

function safeNext(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}

export async function POST(request: Request) {
  // A plain form post carries no action-id handshake, so check the origin ourselves.
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  const email = String(form?.get('email') ?? '').trim();
  const password = String(form?.get('password') ?? '');
  const next = safeNext(form?.get('next') ? String(form.get('next')) : null);

  if (!email || !password) {
    return back(request, { error: 'missing', next: next ?? '' });
  }

  // Same message whether the email is unknown or the password is wrong, so the form is
  // not an account-enumeration oracle. `signIn` also resolves which centre is meant
  // when one address holds an account at more than one.
  const result = await signIn(email, password);
  if (!result.ok) return back(request, { error: 'invalid', next: next ?? '' });
  const found = result.user;

  const token = await createSessionToken(
    { uid: found.id, cid: found.centreId, role: found.role },
    env.SESSION_SECRET,
  );
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });

  const target = next ?? '/floor';
  const allowedForAssistant = /^\/(floor|emergency|kiosk)/.test(target);
  const destination = found.role === 'assistant' && !allowedForAssistant ? '/floor' : target;

  return NextResponse.redirect(new URL(destination, request.url), 303);
}
