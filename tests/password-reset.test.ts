import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { asDb, createTestDb, makeCentre, makeUser, type TestDb } from './helpers/db';
import { passwordResetToken, user as userT } from '@/db/schema';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import {
  checkResetToken,
  hashResetToken,
  pruneResetTokens,
  requestPasswordReset,
  resetPasswordWithToken,
} from '@/lib/auth/password-reset';
import { RecordingEmailProvider, setEmailProvider } from '@/lib/email/provider';

const ORIGIN = 'https://centre.example';

/** The link is the product of this feature, so the tests read it the way a user would. */
function tokenFromEmail(text: string): string {
  const match = /\/reset-password\?token=([^\s]+)/.exec(text);
  if (!match?.[1]) throw new Error(`No reset link in email:\n${text}`);
  return decodeURIComponent(match[1]);
}

async function passwordHashOf(db: TestDb, userId: string): Promise<string> {
  const rows = await db
    .select({ passwordHash: userT.passwordHash })
    .from(userT)
    .where(eq(userT.id, userId))
    .limit(1);
  return rows[0]!.passwordHash;
}

describe('password reset', () => {
  let db: TestDb;
  let cleanup: () => Promise<void>;
  let email: RecordingEmailProvider;

  beforeAll(async () => {
    ({ db, cleanup } = await createTestDb());
  });
  afterAll(async () => {
    setEmailProvider(null);
    await cleanup();
  });

  // A fresh recorder per test, so `email.last` is never a leftover from the one before.
  beforeEach(() => {
    email = new RecordingEmailProvider();
    setEmailProvider(email);
  });
  afterEach(() => setEmailProvider(null));

  async function staff(overrides: Partial<typeof userT.$inferInsert> = {}) {
    const centre = await makeCentre(db);
    const tag = Math.random().toString(36).slice(2, 8);
    const person = await makeUser(db, centre.id, {
      email: `devon-${tag}@example.com`,
      name: 'Devon Ruiz',
      passwordHash: await hashPassword('the-old-password'),
      ...overrides,
    });
    return { centre, person };
  }

  it('emails a working link to the address on the account', async () => {
    const { centre, person } = await staff();

    const outcome = await requestPasswordReset(
      { email: person.email, origin: ORIGIN },
      asDb(db),
    );

    expect(outcome.status).toBe('sent');
    expect(email.sent).toHaveLength(1);
    expect(email.last!.to).toBe(person.email);
    expect(email.last!.subject).toContain(centre.name);
    expect(email.last!.text).toContain(`${ORIGIN}/reset-password?token=`);

    const token = tokenFromEmail(email.last!.text);
    const result = await resetPasswordWithToken(
      { token, newPassword: 'a-brand-new-password' },
      asDb(db),
    );

    expect(result.status).toBe('ok');
    expect(await verifyPassword('a-brand-new-password', await passwordHashOf(db, person.id))).toBe(
      true,
    );
    expect(await verifyPassword('the-old-password', await passwordHashOf(db, person.id))).toBe(
      false,
    );
  });

  it('is case-insensitive on the address, like signing in is', async () => {
    const { person } = await staff();

    const outcome = await requestPasswordReset(
      { email: person.email.toUpperCase(), origin: ORIGIN },
      asDb(db),
    );

    expect(outcome.status).toBe('sent');
  });

  it('reports no_account for an unknown address, and sends nothing', async () => {
    const outcome = await requestPasswordReset(
      { email: 'nobody@example.com', origin: ORIGIN },
      asDb(db),
    );

    expect(outcome.status).toBe('no_account');
    expect(email.sent).toHaveLength(0);
  });

  it('stores only the HMAC — the token itself is never written down', async () => {
    const { person } = await staff();
    await requestPasswordReset({ email: person.email, origin: ORIGIN }, asDb(db));
    const token = tokenFromEmail(email.last!.text);

    const rows = await db
      .select()
      .from(passwordResetToken)
      .where(eq(passwordResetToken.userId, person.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toBe(token);
    expect(rows[0]!.tokenHash).toBe(hashResetToken(token));
  });

  it('spends the link — a second use is refused', async () => {
    const { person } = await staff();
    await requestPasswordReset({ email: person.email, origin: ORIGIN }, asDb(db));
    const token = tokenFromEmail(email.last!.text);

    const first = await resetPasswordWithToken(
      { token, newPassword: 'first-new-password' },
      asDb(db),
    );
    expect(first.status).toBe('ok');

    const second = await resetPasswordWithToken(
      { token, newPassword: 'attackers-password' },
      asDb(db),
    );
    expect(second).toEqual({ status: 'invalid', reason: 'used' });

    // The refusal is real, not cosmetic: the first password still stands.
    expect(await verifyPassword('first-new-password', await passwordHashOf(db, person.id))).toBe(
      true,
    );
  });

  it('refuses an expired link', async () => {
    const { person } = await staff();
    const issuedAt = new Date('2026-05-01T10:00:00Z');
    await requestPasswordReset({ email: person.email, origin: ORIGIN, at: issuedAt }, asDb(db));
    const token = tokenFromEmail(email.last!.text);

    const twoHoursLater = new Date(issuedAt.getTime() + 2 * 60 * 60_000);
    const result = await resetPasswordWithToken(
      { token, newPassword: 'too-late-password', at: twoHoursLater },
      asDb(db),
    );

    expect(result).toEqual({ status: 'invalid', reason: 'expired' });
    expect(await verifyPassword('the-old-password', await passwordHashOf(db, person.id))).toBe(
      true,
    );
  });

  it('refuses a token that was never issued', async () => {
    const result = await resetPasswordWithToken(
      { token: 'not-a-real-token', newPassword: 'some-new-password' },
      asDb(db),
    );
    expect(result).toEqual({ status: 'invalid', reason: 'unknown' });
  });

  it('retires the previous link when a second one is requested', async () => {
    const { person } = await staff();
    await requestPasswordReset({ email: person.email, origin: ORIGIN }, asDb(db));
    const firstToken = tokenFromEmail(email.last!.text);

    await requestPasswordReset({ email: person.email, origin: ORIGIN }, asDb(db));
    const secondToken = tokenFromEmail(email.last!.text);
    expect(secondToken).not.toBe(firstToken);

    // Asking twice because the first email was slow must not leave two live links.
    expect(await checkResetToken(firstToken, new Date(), asDb(db))).toEqual({
      valid: false,
      reason: 'used',
    });

    const result = await resetPasswordWithToken(
      { token: secondToken, newPassword: 'the-newest-password' },
      asDb(db),
    );
    expect(result.status).toBe('ok');
  });

  it('kills every other outstanding link for that person on a successful reset', async () => {
    const { person } = await staff();

    // Two tokens in flight at once, which requestPasswordReset alone will not produce —
    // inserted directly to stand in for a link that outlived a schema where it could.
    await db.insert(passwordResetToken).values({
      userId: person.id,
      tokenHash: hashResetToken('stale-outstanding-token'),
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    await requestPasswordReset({ email: person.email, origin: ORIGIN }, asDb(db));
    const token = tokenFromEmail(email.last!.text);

    await resetPasswordWithToken({ token, newPassword: 'the-real-new-password' }, asDb(db));

    const stillOpen = await db
      .select()
      .from(passwordResetToken)
      .where(and(eq(passwordResetToken.userId, person.id), isNull(passwordResetToken.usedAt)));
    expect(stillOpen).toHaveLength(0);
  });

  it('rejects a password shorter than the minimum without spending the link', async () => {
    const { person } = await staff();
    await requestPasswordReset({ email: person.email, origin: ORIGIN }, asDb(db));
    const token = tokenFromEmail(email.last!.text);

    expect(await resetPasswordWithToken({ token, newPassword: 'short' }, asDb(db))).toEqual({
      status: 'weak_password',
    });

    // Still usable — a rejected password is a typo, not an attack, and burning the
    // link would send the person back to their inbox for nothing.
    const retry = await resetPasswordWithToken(
      { token, newPassword: 'a-long-enough-password' },
      asDb(db),
    );
    expect(retry.status).toBe('ok');
  });

  it('leaves the token live when the email provider fails', async () => {
    const { person } = await staff();
    setEmailProvider({
      name: 'broken',
      send: async () => ({ status: 'failed' as const, error: 'resend_422' }),
    });

    const outcome = await requestPasswordReset({ email: person.email, origin: ORIGIN }, asDb(db));
    expect(outcome).toEqual({ status: 'send_failed', error: 'resend_422' });

    const rows = await db
      .select()
      .from(passwordResetToken)
      .where(and(eq(passwordResetToken.userId, person.id), isNull(passwordResetToken.usedAt)));
    expect(rows).toHaveLength(1);
  });

  it('builds the link against the origin it was asked for, without a double slash', async () => {
    const { person } = await staff();
    await requestPasswordReset(
      { email: person.email, origin: 'https://centre.example/' },
      asDb(db),
    );
    expect(email.last!.text).toContain('https://centre.example/reset-password?token=');
    expect(email.last!.text).not.toContain('example//reset-password');
  });

  it('prunes old rows without touching recent ones', async () => {
    const { person } = await staff();
    const old = new Date(Date.now() - 90 * 24 * 60 * 60_000);
    await db.insert(passwordResetToken).values({
      userId: person.id,
      tokenHash: hashResetToken(`ancient-${person.id}`),
      expiresAt: old,
      usedAt: old,
      createdAt: old,
    });
    await requestPasswordReset({ email: person.email, origin: ORIGIN }, asDb(db));
    const liveToken = tokenFromEmail(email.last!.text);

    // The cutoff is global, so other tests in this file contribute rows too — assert
    // on this person's, which is what the claim is actually about.
    const removed = await pruneResetTokens(
      new Date(Date.now() - 30 * 24 * 60 * 60_000),
      asDb(db),
    );
    expect(removed).toBeGreaterThanOrEqual(1);

    const remaining = await db
      .select()
      .from(passwordResetToken)
      .where(eq(passwordResetToken.userId, person.id));
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.tokenHash).toBe(hashResetToken(liveToken));
  });
});
