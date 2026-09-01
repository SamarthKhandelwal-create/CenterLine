import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NO_PASSWORD, canSignIn, hashPassword, verifyPassword } from '@/lib/auth/password';
import { requestPasswordReset } from '@/lib/auth/password-reset';
import { staffShiftStatus } from '@/lib/staff/shifts';
import { toggleStaffShift } from '@/lib/kiosk/staff';
import { asDb, createTestDb, makeCentre, makeUser, type TestDb } from './helpers/db';

let db: TestDb;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});

afterAll(async () => {
  await cleanup();
});

describe('staff accounts with no password', () => {
  it('no password verifies against the marker, including the marker itself', async () => {
    expect(canSignIn(NO_PASSWORD)).toBe(false);
    expect(canSignIn(await hashPassword('anything'))).toBe(true);

    // The sign-in path calls verifyPassword and nothing else, so this is what actually
    // keeps the account out — no special case at the door.
    expect(await verifyPassword('anything', NO_PASSWORD)).toBe(false);
    expect(await verifyPassword(NO_PASSWORD, NO_PASSWORD)).toBe(false);
    expect(await verifyPassword('', NO_PASSWORD)).toBe(false);
  });

  it('cannot be given a password back through the reset flow', async () => {
    const centre = await makeCentre(db);
    await makeUser(db, centre.id, {
      name: 'Eira Raza',
      email: 'kiosk-only@example.test',
      passwordHash: NO_PASSWORD,
      role: 'assistant',
    });

    // Reported as "no account": a reset link would quietly turn a name on the kiosk into
    // a way into the app, and the HTTP layer flattens both outcomes to the same reply.
    const outcome = await requestPasswordReset(
      { email: 'kiosk-only@example.test', origin: 'http://localhost:3000' },
      asDb(db),
    );
    expect(outcome).toEqual({ status: 'no_account' });
  });

  it('still appears on the kiosk and can clock in and out', async () => {
    const centre = await makeCentre(db, { name: 'Kiosk Only Centre' });
    const person = await makeUser(db, centre.id, {
      name: 'Deborah Bostwick',
      email: 'deborah-kiosk@example.test',
      passwordHash: NO_PASSWORD,
      role: 'assistant',
    });

    // The whole point: the account exists for the tile and the shift history, not for
    // signing in. Removing the password must not remove the person from the door.
    const listed = await staffShiftStatus(centre.id, asDb(db));
    expect(listed.map((s) => s.name)).toContain('Deborah Bostwick');

    const at = new Date('2026-05-01T18:00:00Z');
    expect(await toggleStaffShift({ centre, userId: person.id, at }, asDb(db))).toMatchObject({
      ok: true,
      action: 'clock_in',
      name: 'Deborah Bostwick',
    });
    expect(
      await toggleStaffShift(
        { centre, userId: person.id, at: new Date(at.getTime() + 60 * 60_000) },
        asDb(db),
      ),
    ).toMatchObject({ ok: true, action: 'clock_out', durationMinutes: 60 });
  });
});
