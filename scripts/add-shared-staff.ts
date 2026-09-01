/**
 * Adds the shared staff accounts to an existing database, without reseeding:
 *   pnpm staff:add
 *
 * `pnpm db:seed` truncates every table, which is fine for a fresh demo and wrong for a
 * database with real attendance in it. This applies the same SHARED_STAFF list on its
 * own, and is idempotent — running it twice re-points the password and changes nothing
 * else. Run against a stopped server: PGlite allows one writer at a time.
 */
import '../db/load-env';
import { createDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import { createSharedStaff } from '../db/shared-staff';
import { assertExclusive } from '../db/pglite-lock';

async function main() {
  const raw = process.env.DATABASE_URL ?? 'file:./.pgdata';
  if ((process.env.DATABASE_DRIVER ?? 'pglite') === 'pglite' && raw.startsWith('file:')) {
    assertExclusive(raw.replace(/^file:/, ''));
  }

  const db = createDb();
  await runMigrations(db);

  for (const line of await createSharedStaff(db)) console.log(`  ${line}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
