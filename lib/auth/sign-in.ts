import 'server-only';
import { sql } from 'drizzle-orm';
import { db as defaultDb, type Db } from '@/db';
import { user as userT } from '@/db/schema';
import { verifyPassword } from './password';

/** A hash that cannot match, in the stored format, so a miss still costs one scrypt. */
const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAA';

export type SignInResult =
  | { ok: true; user: typeof userT.$inferSelect }
  | { ok: false };

/**
 * Resolves an email and password to the one account they name.
 *
 * An address can hold an account at more than one centre — the same person working at
 * two of them. Nothing in the form says which is meant, so the password does: every row
 * for the address is tried and the one that verifies wins. The two accounts therefore
 * must not share a password; `db/shared-staff.ts` keeps them apart by giving each its
 * own environment variable.
 *
 * Timing is kept flat on the miss path. An address with no accounts at all still pays
 * for one verify, so the form cannot be used to tell a real address from an invented
 * one. A known address costs one verify per account, which leaks the *number* of
 * centres a person works at to someone already holding their address — accepted, since
 * the alternative is padding every sign-in to a fixed worst case.
 */
export async function signIn(
  email: string,
  password: string,
  db: Db = defaultDb,
): Promise<SignInResult> {
  const rows = await db
    .select()
    .from(userT)
    .where(sql`lower(${userT.email}) = ${email.trim().toLowerCase()}`);

  for (const row of rows) {
    if (await verifyPassword(password, row.passwordHash)) return { ok: true, user: row };
  }

  if (rows.length === 0) await verifyPassword(password, DUMMY_HASH);
  return { ok: false };
}
