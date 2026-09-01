import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, NO_PASSWORD } from '@/lib/auth/password';
import { signIn } from '@/lib/auth/sign-in';
import { requestPasswordReset } from '@/lib/auth/password-reset';
import { asDb, createTestDb, makeCentre, makeUser, type TestDb } from './helpers/db';

let db: TestDb;
let cleanup: () => Promise<void>;

const EMAIL = 'sonam@example.com';

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});

afterAll(async () => {
  await cleanup();
});

/**
 * One person, two centres, one address. The password is what says which account is
 * meant — see lib/auth/sign-in.ts.
 */
describe('one address, an account at two centres', () => {
  it('signs in to whichever centre the password belongs to', async () => {
    const north = await makeCentre(db, { name: 'North' });
    const west = await makeCentre(db, { name: 'West' });

    const a = await makeUser(db, north.id, {
      email: EMAIL,
      name: 'Sonam Khandelwal',
      role: 'instructor',
      passwordHash: await hashPassword('north-password-1'),
    });
    const b = await makeUser(db, west.id, {
      email: EMAIL,
      name: 'Sonam Khandelwal',
      role: 'instructor',
      passwordHash: await hashPassword('west-password-2'),
    });

    const asNorth = await signIn(EMAIL, 'north-password-1', asDb(db));
    expect(asNorth.ok).toBe(true);
    if (asNorth.ok) {
      expect(asNorth.user.id).toBe(a.id);
      expect(asNorth.user.centreId).toBe(north.id);
    }

    const asWest = await signIn(EMAIL, 'west-password-2', asDb(db));
    expect(asWest.ok).toBe(true);
    if (asWest.ok) {
      expect(asWest.user.id).toBe(b.id);
      expect(asWest.user.centreId).toBe(west.id);
    }

    // A password belonging to neither still fails, rather than matching "some row".
    expect((await signIn(EMAIL, 'neither-of-them', asDb(db))).ok).toBe(false);
  });

  it('is case-insensitive on the address, the same as a single-centre sign-in', async () => {
    const result = await signIn(EMAIL.toUpperCase(), 'north-password-1', asDb(db));
    expect(result.ok).toBe(true);
  });

  it('refuses an unknown address without revealing that it is unknown', async () => {
    expect((await signIn('nobody@example.com', 'north-password-1', asDb(db))).ok).toBe(false);
  });

  it('lets the same address be reused across centres but not within one', async () => {
    const centre = await makeCentre(db, { name: 'Solo' });
    await makeUser(db, centre.id, {
      email: 'dup@example.com',
      passwordHash: await hashPassword('first-password'),
    });

    // The unique index is (centre_id, lower(email)), so a second row at the SAME centre
    // is rejected by the database rather than quietly shadowing the first.
    await expect(
      makeUser(db, centre.id, {
        email: 'DUP@example.com',
        passwordHash: await hashPassword('second-password'),
      }),
    ).rejects.toThrow();
  });

  it('emails a reset link for every centre the address has an account at', async () => {
    const outcome = await requestPasswordReset(
      { email: EMAIL, origin: 'https://example.test' },
      asDb(db),
    );
    // Both accounts are live, so both are sent one — picking between them silently
    // would reset a password the person did not ask about.
    expect(outcome.status).toBe('sent');

    const result = (await db.execute(
      `SELECT count(*)::int AS n FROM password_reset_token t
       JOIN "user" u ON u.id = t.user_id
       WHERE lower(u.email) = '${EMAIL}' AND t.used_at IS NULL`,
    )) as unknown as { rows?: { n: number }[] } | { n: number }[];
    const rows = Array.isArray(result) ? result : (result.rows ?? []);
    expect(rows[0]!.n).toBe(2);
  });

  it('skips an account with no password when the other centre still has one', async () => {
    const centre = await makeCentre(db, { name: 'Kiosk only' });
    await makeUser(db, centre.id, {
      email: 'mixed@example.com',
      passwordHash: NO_PASSWORD,
    });

    // Only the passwordless account exists, so this is treated as an unknown address.
    const outcome = await requestPasswordReset(
      { email: 'mixed@example.com', origin: 'https://example.test' },
      asDb(db),
    );
    expect(outcome.status).toBe('no_account');
  });
});
