import { beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { createKioskToken, createSessionToken } from '@/lib/auth/session';

/**
 * The reported bug: sign in to Liberty, press Open kiosk, and Mason West's roster
 * comes up.
 *
 * A device cookie lasts 400 days and a browser shares its jar across every tab, so on
 * a shared desktop a tablet enrolled at one centre kept winning over whoever was
 * actually signed in. Nothing re-checked the two against each other once the device
 * was enrolled, and the kiosk shows a roster of real children — so the wrong one is
 * not a cosmetic fault.
 *
 * Middleware is the only place both cookies are read together, so it is tested here
 * directly rather than through a running server.
 */
const SESSION_SECRET = 'test-session-secret-which-is-long-enough';
const KIOSK_SECRET = 'test-kiosk-secret-which-is-long-enough';

const LIBERTY = '11111111-1111-4111-8111-111111111111';
const MASON = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';

let middleware: (req: NextRequest) => Promise<Response>;

beforeAll(async () => {
  process.env.SESSION_SECRET = SESSION_SECRET;
  process.env.KIOSK_SECRET = KIOSK_SECRET;
  ({ middleware } = await import('@/middleware'));
});

async function get(path: string, cookies: Record<string, string>) {
  const req = new NextRequest(new URL(path, 'http://localhost'), {
    headers: {
      cookie: Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; '),
    },
  });
  return middleware(req);
}

const kioskAt = (centreId: string) =>
  createKioskToken(centreId, 'Front door', KIOSK_SECRET, 'instructor');
const sessionAt = (centreId: string) =>
  createSessionToken({ uid: USER, cid: centreId, role: 'instructor' }, SESSION_SECRET);

describe('a kiosk device and a staff session that disagree', () => {
  it('does not serve one centre a kiosk enrolled at another', async () => {
    const res = await get('/kiosk', {
      cl_kiosk: await kioskAt(MASON),
      cl_session: await sessionAt(LIBERTY),
    });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/kiosk/enroll?mismatch=1');
  });

  /**
   * The door tablet is the normal case and must be untouched: it holds a device cookie
   * and no staff session, so there is nothing to disagree with.
   */
  it('leaves a door tablet with no staff session alone', async () => {
    const res = await get('/kiosk', { cl_kiosk: await kioskAt(MASON) });
    expect(res.headers.get('location')).toBeNull();
  });

  it('lets a matching pair straight through', async () => {
    for (const centre of [LIBERTY, MASON]) {
      const res = await get('/kiosk', {
        cl_kiosk: await kioskAt(centre),
        cl_session: await sessionAt(centre),
      });
      expect(res.headers.get('location')).toBeNull();
    }
  });

  it('guards the kiosk API routes too, not only the screen', async () => {
    // The screen reads the device cookie for its roster, but the tap and scan routes
    // write attendance. A mismatch there would record a child at the wrong centre.
    for (const path of ['/api/kiosk/tap', '/api/kiosk/staff']) {
      const res = await get(path, {
        cl_kiosk: await kioskAt(MASON),
        cl_session: await sessionAt(LIBERTY),
      });
      expect(res.headers.get('location')).toContain('/kiosk/enroll?mismatch=1');
    }
  });

  it('still lets the enrol screen itself load, or there is no way out', async () => {
    const res = await get('/kiosk/enroll', {
      cl_kiosk: await kioskAt(MASON),
      cl_session: await sessionAt(LIBERTY),
    });
    expect(res.headers.get('location')).toBeNull();
  });

  it('sends a device with no kiosk cookie and no session to sign in', async () => {
    const res = await get('/kiosk', {});
    expect(res.headers.get('location')).toContain('/login');
  });

  it('sends a signed-in person on an unenrolled device to enrol it', async () => {
    const res = await get('/kiosk', { cl_session: await sessionAt(LIBERTY) });
    expect(res.headers.get('location')).toContain('/kiosk/enroll');
    expect(res.headers.get('location')).not.toContain('mismatch');
  });

  /** A tampered or stale device cookie is not a mismatch; it is simply not a kiosk. */
  it('treats an unreadable kiosk cookie as no kiosk at all', async () => {
    const res = await get('/kiosk', {
      cl_kiosk: 'not-a-real-token',
      cl_session: await sessionAt(LIBERTY),
    });
    expect(res.headers.get('location')).toContain('/kiosk/enroll');
    expect(res.headers.get('location')).not.toContain('mismatch');
  });
});

/**
 * The compliance screen is switched off rather than deleted, so the gate is what makes
 * "removed" true — the files are all still on disk and the route still renders.
 */
describe('the compliance screen, switched off', () => {
  it('is not reachable by typing the URL', async () => {
    for (const path of ['/compliance', '/api/compliance/evidence']) {
      const res = await get(path, { cl_session: await sessionAt(LIBERTY) });
      expect(res.headers.get('location')).toContain('/floor');
    }
  });

  it('leaves every other instructor screen alone', async () => {
    for (const path of ['/floor', '/students', '/schedule', '/day', '/history', '/staff']) {
      const res = await get(path, { cl_session: await sessionAt(LIBERTY) });
      expect(res.headers.get('location')).toBeNull();
    }
  });
});
