/**
 * Removes the password from staff accounts that do not need one:
 *   pnpm staff:no-password  someone@example.com  another@example.com
 *
 * Staff clock in and out at the kiosk by tapping their tile, which needs an account for
 * the name and the shift history but no credential. This replaces the stored hash with
 * `NO_PASSWORD`, after which sign-in fails through the ordinary path and a reset link
 * cannot be requested for it either.
 *
 * Reversible: `pnpm staff:add` or a fresh staff import gives an account a real password
 * again. Run against a stopped server — PGlite allows one writer at a time.
 */
import '../db/load-env';
import { sql } from 'drizzle-orm';
import { createDb } from '../db/client';
import { user as userT } from '../db/schema';
import { NO_PASSWORD, canSignIn } from '../lib/auth/password';
import { assertExclusive } from '../db/pglite-lock';

async function main() {
  const emails = process.argv.slice(2).map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (emails.length === 0) {
    console.error('Usage: pnpm staff:no-password <email> [email...]');
    process.exit(1);
  }

  const raw = process.env.DATABASE_URL ?? 'file:./.pgdata';
  if ((process.env.DATABASE_DRIVER ?? 'pglite') === 'pglite' && raw.startsWith('file:')) {
    assertExclusive(raw.replace(/^file:/, ''));
  }

  const db = createDb();

  for (const email of emails) {
    const rows = await db
      .select({ id: userT.id, name: userT.name, role: userT.role, passwordHash: userT.passwordHash })
      .from(userT)
      .where(sql`lower(${userT.email}) = ${email}`)
      .limit(1);

    const found = rows[0];
    if (!found) {
      console.log(`  ${email} — SKIPPED, no such account`);
      continue;
    }
    if (!canSignIn(found.passwordHash)) {
      console.log(`  ${email} — already has no password`);
      continue;
    }

    await db.update(userT).set({ passwordHash: NO_PASSWORD }).where(sql`${userT.id} = ${found.id}`);
    console.log(`  ${email} — password removed (${found.name}, ${found.role})`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
