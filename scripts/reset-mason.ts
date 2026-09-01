/**
 * Rebuilds Kumon of Mason West from a real roster export:
 *   pnpm mason:reset <path-to-xlsx>
 *
 * Clears only that centre's roster — students, guardians, credentials and the
 * attendance recorded against them — then imports the file through the ordinary
 * analyze/commit path so matching and normalisation behave exactly as they do in the
 * UI. Other centres are untouched. Run against a stopped server: PGlite allows one
 * writer at a time.
 */
import '../db/load-env';
import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { createDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import { centre as centreT } from '../db/schema';
import { createSharedStaff } from '../db/shared-staff';
import { assertExclusive } from '../db/pglite-lock';

const CENTRE_NAME = 'Kumon of Mason West';

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: pnpm mason:reset <path-to-xlsx>');
    process.exit(1);
  }

  const raw = process.env.DATABASE_URL ?? 'file:./.pgdata';
  if ((process.env.DATABASE_DRIVER ?? 'pglite') === 'pglite' && raw.startsWith('file:')) {
    assertExclusive(raw.replace(/^file:/, ''));
  }

  const db = createDb();
  await runMigrations(db);

  const centres = await db
    .select({ id: centreT.id })
    .from(centreT)
    .where(eq(centreT.name, CENTRE_NAME))
    .limit(1);

  const centreId = centres[0]?.id;
  if (!centreId) throw new Error(`No centre named "${CENTRE_NAME}"`);

  const { analyzeImport } = await import('../lib/import/analyze');
  const { commitImport } = await import('../lib/import/commit');

  // attendance_event is append-only via trigger, which the application must never work
  // around. A scoped rebuild of one centre is not an application path: drop the guard
  // for this delete only, then restore it. TRUNCATE (what db/seed.ts uses) is not an
  // option here because it cannot be limited to a single centre.
  await db.execute(sql`DROP TRIGGER IF EXISTS attendance_event_no_delete ON attendance_event`);
  try {
    await db.execute(sql`DELETE FROM attendance_event WHERE centre_id = ${centreId}`);
  } finally {
    await db.execute(sql`
      CREATE TRIGGER attendance_event_no_delete
        BEFORE DELETE ON attendance_event
        FOR EACH ROW EXECUTE FUNCTION attendance_event_append_only()
    `);
  }

  // Guardians and credentials cascade from student.
  await db.execute(sql`DELETE FROM message_log WHERE centre_id = ${centreId}`);
  await db.execute(sql`DELETE FROM student_import_key WHERE centre_id = ${centreId}`);
  await db.execute(sql`DELETE FROM staff_shift WHERE centre_id = ${centreId}`);
  await db.execute(sql`DELETE FROM student WHERE centre_id = ${centreId}`);
  await db.execute(sql`DELETE FROM guardian WHERE centre_id = ${centreId}`);
  console.log(`Cleared roster for ${CENTRE_NAME}`);

  const plan = await analyzeImport(centreId, readFileSync(file), db);
  const result = await commitImport({ centreId, plan }, db);
  console.log(
    `Imported: ${result.created} created, ${result.updated} updated, ` +
      `${result.unchanged} unchanged, ${result.skipped} skipped`,
  );

  for (const line of await createSharedStaff(db)) console.log(`  ${line}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
