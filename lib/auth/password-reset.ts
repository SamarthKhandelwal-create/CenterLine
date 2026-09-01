import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db as defaultDb, type Db } from '@/db';
import { centre as centreT, passwordResetToken, user as userT } from '@/db/schema';
import { env } from '@/lib/env';
import { getEmailProvider } from '@/lib/email/provider';
import { RESET_EXPIRY_MINUTES, passwordResetEmail } from '@/lib/email/templates';
import { canSignIn, hashPassword } from './password';

export const MIN_PASSWORD_LENGTH = 10;
const TOKEN_TTL_MS = RESET_EXPIRY_MINUTES * 60_000;

/**
 * 32 bytes from the CSPRNG. Long enough that guessing is not a threat model, short
 * enough to survive a mail client wrapping the line.
 */
function generateResetToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Only the HMAC reaches the database, keyed by the same secret that protects student
 * cards. A read of `password_reset_token` therefore yields nothing an attacker can put
 * in a URL — the same reason `credential` stores a hash rather than the token.
 *
 * HMAC rather than scrypt because the input is already 256 bits of entropy: there is
 * no dictionary to slow down, and a reset link click should not cost a KDF.
 */
export function hashResetToken(token: string): string {
  return createHmac('sha256', env.CREDENTIAL_HMAC_SECRET).update(token).digest('base64url');
}

export type ResetRequestOutcome =
  | { status: 'sent' }
  | { status: 'no_account' }
  | { status: 'send_failed'; error: string };

/**
 * Issues a reset and emails it.
 *
 * The caller must not vary its response on the outcome — see the route. This function
 * reports honestly so the server log and the tests can see what happened; the HTTP
 * layer is what flattens it.
 *
 * Any outstanding token for the user is retired first. Asking twice because the first
 * email was slow should not leave two live links, and the newest request is the one
 * the person is looking at.
 */
export async function requestPasswordReset(
  args: { email: string; origin: string; at?: Date },
  db: Db = defaultDb,
): Promise<ResetRequestOutcome> {
  const at = args.at ?? new Date();
  const email = args.email.trim().toLowerCase();
  if (!email) return { status: 'no_account' };

  const rows = await db
    .select({
      id: userT.id,
      email: userT.email,
      name: userT.name,
      passwordHash: userT.passwordHash,
      centreName: centreT.name,
    })
    .from(userT)
    .innerJoin(centreT, eq(centreT.id, userT.centreId))
    .where(sql`lower(${userT.email}) = ${email}`)
    .limit(1);

  const found = rows[0];
  if (!found) return { status: 'no_account' };

  // An account with no password is a name on the kiosk, not a way in. Issuing a reset
  // link would quietly turn it into a sign-in account, which is the opposite of what
  // removing the password meant — so it is treated exactly like an unknown address.
  // Giving one a password back is an instructor's decision, made deliberately.
  if (!canSignIn(found.passwordHash)) return { status: 'no_account' };

  const token = generateResetToken();

  await db.transaction(async (tx) => {
    await tx
      .update(passwordResetToken)
      .set({ usedAt: at })
      .where(and(eq(passwordResetToken.userId, found.id), isNull(passwordResetToken.usedAt)));

    await tx.insert(passwordResetToken).values({
      userId: found.id,
      tokenHash: hashResetToken(token),
      expiresAt: new Date(at.getTime() + TOKEN_TTL_MS),
      createdAt: at,
    });
  });

  const base = (env.APP_URL ?? args.origin).replace(/\/$/, '');
  const resetUrl = `${base}/reset-password?token=${encodeURIComponent(token)}`;

  const result = await getEmailProvider().send(
    passwordResetEmail({
      to: found.email,
      name: found.name,
      centreName: found.centreName,
      resetUrl,
    }),
  );

  if (result.status === 'failed') {
    // The token stays live. A provider outage should not also cost the person their
    // reset — an instructor can read the link out of the server log, and a retry in
    // two minutes issues a fresh one.
    console.error(`[password-reset] send failed for ${found.email}: ${result.error}`);
    return { status: 'send_failed', error: result.error };
  }

  return { status: 'sent' };
}

export type ResetTokenCheck =
  | { valid: true; userId: string; tokenId: string }
  | { valid: false; reason: 'unknown' | 'used' | 'expired' };

/**
 * Looks a token up without spending it. Used by the reset page so a dead link is a
 * sentence on screen rather than a form that fails after the person has typed a
 * password into it twice.
 */
export async function checkResetToken(
  token: string,
  at: Date = new Date(),
  db: Db = defaultDb,
): Promise<ResetTokenCheck> {
  if (!token) return { valid: false, reason: 'unknown' };

  const hash = hashResetToken(token);
  const rows = await db
    .select()
    .from(passwordResetToken)
    .where(eq(passwordResetToken.tokenHash, hash))
    .limit(1);

  const row = rows[0];
  if (!row) return { valid: false, reason: 'unknown' };

  // Constant-time even though the lookup above was an indexed equality — the compare
  // costs nothing and keeps the shape right if this ever becomes a scan.
  const a = Buffer.from(row.tokenHash);
  const b = Buffer.from(hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false, reason: 'unknown' };

  if (row.usedAt !== null) return { valid: false, reason: 'used' };
  if (row.expiresAt.getTime() <= at.getTime()) return { valid: false, reason: 'expired' };

  return { valid: true, userId: row.userId, tokenId: row.id };
}

export type ResetOutcome =
  | { status: 'ok'; userId: string }
  | { status: 'invalid'; reason: 'unknown' | 'used' | 'expired' }
  | { status: 'weak_password' };

/**
 * Spends the token and sets the new password, in one transaction.
 *
 * The UPDATE that marks the token used carries `used_at IS NULL` in its WHERE clause
 * and the outcome is decided by how many rows came back. Two tabs submitting the same
 * link at once is not a race this can afford to lose — that is a second password
 * change nobody asked for — and checking-then-writing would lose it.
 */
export async function resetPasswordWithToken(
  args: { token: string; newPassword: string; at?: Date },
  db: Db = defaultDb,
): Promise<ResetOutcome> {
  const at = args.at ?? new Date();

  if (args.newPassword.normalize('NFKC').length < MIN_PASSWORD_LENGTH) {
    return { status: 'weak_password' };
  }

  const check = await checkResetToken(args.token, at, db);
  if (!check.valid) return { status: 'invalid', reason: check.reason };

  const passwordHash = await hashPassword(args.newPassword);

  return db.transaction(async (tx) => {
    const claimed = await tx
      .update(passwordResetToken)
      .set({ usedAt: at })
      .where(and(eq(passwordResetToken.id, check.tokenId), isNull(passwordResetToken.usedAt)))
      .returning({ userId: passwordResetToken.userId });

    const row = claimed[0];
    if (!row) return { status: 'invalid', reason: 'used' } as const;

    await tx.update(userT).set({ passwordHash }).where(eq(userT.id, row.userId));

    // Any other link outstanding for this person dies with the password it was issued
    // against — including one an attacker requested moments before.
    await tx
      .update(passwordResetToken)
      .set({ usedAt: at })
      .where(and(eq(passwordResetToken.userId, row.userId), isNull(passwordResetToken.usedAt)));

    return { status: 'ok', userId: row.userId } as const;
  });
}

/** Housekeeping for spent and expired rows. Nothing depends on it running. */
export async function pruneResetTokens(
  olderThan: Date = new Date(Date.now() - 30 * 24 * 60 * 60_000),
  db: Db = defaultDb,
): Promise<number> {
  const rows = await db
    .delete(passwordResetToken)
    .where(sql`${passwordResetToken.createdAt} < ${olderThan.toISOString()}`)
    .returning({ id: passwordResetToken.id });
  return rows.length;
}
