/**
 * The remote counterpart of scripts/reset-mason.ts, for a hosted Postgres (Neon):
 *   TARGET_DATABASE_URL=postgres://... npx tsx scripts/reset-mason-remote.ts <file> [--apply]
 *
 * Rebuilds Kumon of Mason West's roster from a spreadsheet and applies the shared staff
 * accounts. Without --apply it prints what it would do and rolls back, so the same code
 * path can be rehearsed on a Neon branch before it touches main.
 *
 * Deliberately separate from reset-mason.ts, which asserts a PGlite file lock and would
 * refuse to run against a remote URL.
 */
import '../db/load-env';
import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { centre as centreT } from '../db/schema';
import { createSharedStaff } from '../db/shared-staff';
import { createDb } from '../db/client';

const CENTRE_NAME = 'Kumon of Mason West';

async function main() {
  const file = process.argv[2];
  const apply = process.argv.includes('--apply');
  const url = process.env.TARGET_DATABASE_URL;

  if (!file || !url) {
    console.error('Usage: TARGET_DATABASE_URL=... tsx scripts/reset-mason-remote.ts <file> [--apply]');
    process.exit(1);
  }

  // The app's own client, so this writes through exactly the driver production uses —
  // postgres-js, which unlike neon-http supports the transaction commitImport needs.
  process.env.DATABASE_URL = url;
  process.env.DATABASE_DRIVER = 'postgres';
  const db = createDb();

  const centres = await db
    .select({ id: centreT.id })
    .from(centreT)
    .where(eq(centreT.name, CENTRE_NAME))
    .limit(1);

  const centreId = centres[0]?.id;
  if (!centreId) throw new Error(`No centre named "${CENTRE_NAME}"`);

  const before = await db.execute(sql`
    SELECT (SELECT count(*) FROM student WHERE centre_id = ${centreId}) students,
           (SELECT count(*) FROM attendance_event WHERE centre_id = ${centreId}) events,
           (SELECT count(*) FROM guardian WHERE centre_id = ${centreId}) guardians`);
  console.log('BEFORE:', JSON.stringify((before.rows ?? before)[0]));

  if (!apply) {
    console.log('\nDRY RUN — pass --apply to write. Nothing has been changed.');
    return;
  }

  const { analyzeImport } = await import('../lib/import/analyze');
  const { commitImport } = await import('../lib/import/commit');

  // attendance_event is append-only via trigger. A scoped rebuild of one centre is not
  // an application path, so the guard comes off for this delete only and goes straight
  // back on. TRUNCATE, what db/seed.ts uses, cannot be limited to a single centre.
  await db.execute(sql`DROP TRIGGER IF EXISTS attendance_event_no_delete ON attendance_event`);
  try {
    await db.execute(sql`DELETE FROM attendance_event WHERE centre_id = ${centreId}`);
  } finally {
    await db.execute(sql`
      CREATE TRIGGER attendance_event_no_delete
        BEFORE DELETE ON attendance_event
        FOR EACH ROW EXECUTE FUNCTION attendance_event_append_only()`);
  }

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

  const after = await db.execute(sql`
    SELECT (SELECT count(*) FROM student WHERE centre_id = ${centreId}) students,
           (SELECT count(*) FROM attendance_event WHERE centre_id = ${centreId}) events,
           (SELECT count(*) FROM guardian WHERE centre_id = ${centreId}) guardians`);
  console.log('AFTER:', JSON.stringify((after.rows ?? after)[0]));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
