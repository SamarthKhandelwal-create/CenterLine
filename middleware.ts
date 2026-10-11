import { NextResponse, type NextRequest } from 'next/server';
import { KIOSK_COOKIE, SESSION_COOKIE, readKioskToken, readSessionToken } from '@/lib/auth/session';

/**
 * Routing and role gating only. Middleware runs on the Edge and never touches the
 * database — it reads claims out of the signed cookie. Every mutation independently
 * re-checks the user against the database (lib/auth/current-user.ts), so this layer
 * is UX, not the security boundary.
 */

/** Assistants get a positive allow-list, so any new route is locked by default. */
const ASSISTANT_ALLOWED = ['/floor', '/emergency', '/kiosk'];

/**
 * The compliance screen and its evidence pack are switched off at the request of the
 * centre. Nothing is deleted: the route, the PDF export and every recorded attestation
 * are intact, and setting ENABLE_COMPLIANCE=1 brings the screen back. Gated here as
 * well as hidden from the navigation so that typing the URL does not reach it.
 */
const COMPLIANCE_ENABLED = process.env.ENABLE_COMPLIANCE === '1';
const COMPLIANCE_PATHS = ['/compliance', '/api/compliance'];

// /api/auth is how you sign in and out, so it cannot require a session to reach.
// The two reset screens are for people who cannot sign in by definition, so they
// belong here for exactly the same reason /login does.
const PUBLIC = [
  '/login',
  '/forgot-password',
  '/reset-password',
  '/api/auth',
  '/api/cron',
  '/api/webhooks',
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  if (
    !COMPLIANCE_ENABLED &&
    COMPLIANCE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  ) {
    return NextResponse.redirect(new URL('/floor', req.url));
  }

  // The kiosk is authorised by a device cookie, never a staff login — a tablet by
  // the door must not carry an instructor session.
  if (pathname === '/kiosk' || pathname.startsWith('/kiosk/') || pathname.startsWith('/api/kiosk')) {
    if (pathname === '/kiosk/enroll') return NextResponse.next();
    const kiosk = await readKioskToken(
      req.cookies.get(KIOSK_COOKIE)?.value,
      process.env.KIOSK_SECRET ?? '',
    );
    const staff = await readSessionToken(
      req.cookies.get(SESSION_COOKIE)?.value,
      process.env.SESSION_SECRET ?? '',
    );

    if (kiosk) {
      /**
       * A device cookie lasts 400 days and a browser shares its cookie jar across every
       * tab, so on a shared desktop a tablet enrolled at one centre kept winning over
       * whoever was actually signed in: sign into Liberty, press Open kiosk, and Mason
       * West's roster came up. The enrol screen already asks which centre it is binding,
       * but nothing re-checked it afterwards.
       *
       * A mismatch is only ever a real device being borrowed by a signed-in person, so
       * it asks rather than assumes — neither centre's roster is the safe default, and
       * silently showing the wrong children is the failure being fixed. The door tablet
       * is unaffected: it holds no staff session, so there is nothing to disagree with.
       */
      if (staff && staff.cid !== kiosk.cid) {
        return NextResponse.redirect(new URL('/kiosk/enroll?mismatch=1', req.url));
      }
      return NextResponse.next();
    }

    // Fall through: a logged-in staff member may open the kiosk to enrol the device.
    if (staff) return NextResponse.redirect(new URL('/kiosk/enroll', req.url));
    return NextResponse.redirect(new URL('/login?next=/kiosk', req.url));
  }

  const claims = await readSessionToken(
    req.cookies.get(SESSION_COOKIE)?.value,
    process.env.SESSION_SECRET ?? '',
  );
  if (!claims) {
    const url = new URL('/login', req.url);
    if (pathname !== '/') url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (claims.role === 'assistant') {
    const allowed = ASSISTANT_ALLOWED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
    if (!allowed) return NextResponse.redirect(new URL('/floor', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
