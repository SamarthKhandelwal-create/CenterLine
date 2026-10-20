/**
 * Opens a new centre from its roster export:
 *   npx tsx scripts/add-centre.ts <centre-key> <path-to-xlsx> [--apply]
 *   TARGET_DATABASE_URL=postgres://... npx tsx scripts/add-centre.ts <centre-key> <file> [--apply]
 *
 * Creates the centre row, imports the roster through the ordinary analyze/commit path
 * so matching and normalisation behave exactly as they do in the UI, then applies this
 * centre's accounts from db/shared-staff.ts — no other centre's. Without --apply it prints what the file
 * would import and writes nothing.
 *
 * Idempotent: an existing centre of the same name is reused rather than duplicated, and
 * a re-import of the same file changes nothing. It never clears a roster — that is what
 * scripts/reset-mason.ts is for.
 *
 * With TARGET_DATABASE_URL it writes to that Postgres (Neon) through postgres-js, the
 * driver production uses; without it, to the local PGlite file, against a stopped server.
 */
import '../db/load-env';
import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { centre as centreT } from '../db/schema';
import { createSharedStaff } from '../db/shared-staff';
import { assertExclusive } from '../db/pglite-lock';

/** Centres opened this way. Both are in the Cincinnati area, on Eastern time. */
const NEW_CENTRES = {
  anderson: {
    name: 'Kumon of Anderson',
    timezone: 'America/New_York',
    phone: '+15134743400',
    // Mon/Tue/Thu 3:30–7:00 PM per its public listing; the roster's latest arrival is 6:30.
    closeTime: '19:00:00',
  },
} as const;

async function main() {
  const [key, file] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const apply = process.argv.includes('--apply');
  const spec = NEW_CENTRES[key as keyof typeof NEW_CENTRES];
  if (!spec || !file) {
    console.error(
      `Usage: [TARGET_DATABASE_URL=...] tsx scripts/add-centre.ts <${Object.keys(NEW_CENTRES).join('|')}> <file> [--apply]`,
    );
    process.exit(1);
  }

  const target = process.env.TARGET_DATABASE_URL;
  if (target) {
    process.env.DATABASE_URL = target;
    process.env.DATABASE_DRIVER = 'postgres';
  } else {
    const raw = process.env.DATABASE_URL ?? 'file:./.pgdata';
    if ((process.env.DATABASE_DRIVER ?? 'pglite') === 'pglite' && raw.startsWith('file:')) {
      assertExclusive(raw.replace(/^file:/, ''));
    }
  }
  console.log(`Target: ${target ? 'TARGET_DATABASE_URL' : 'local PGlite'}`);

  // Imported after the driver is chosen: db/client reads it from the environment.
  const { createDb } = await import('../db/client');
  const { runMigrations } = await import('../db/migrate');
  const { analyzeImport } = await import('../lib/import/analyze');
  const { commitImport } = await import('../lib/import/commit');
  const db = createDb();
  if (!target) await runMigrations(db);

  const existing = await db
    .select({ id: centreT.id })
    .from(centreT)
    .where(eq(centreT.name, spec.name))
    .limit(1);

  // A centre that does not exist yet has no students to match against, so an id that
  // names nothing previews exactly what a fresh import would create.
  const previewId = existing[0]?.id ?? '00000000-0000-0000-0000-000000000000';
  const plan = await analyzeImport(previewId, readFileSync(file), db);

  console.log(`${spec.name}: ${existing[0] ? 'exists, will be reused' : 'will be created'}`);
  console.log('Counts:', JSON.stringify(plan.counts));
  console.log('Unmapped columns:', plan.unmappedHeaders.join(', ') || 'none');
  const noPhone = plan.items.filter((i) => !i.candidate.guardianPhone).length;
  const noDays = plan.items.filter((i) => !i.candidate.schedule?.length).length;
  console.log(`Students with no guardian phone: ${noPhone}; with no class day: ${noDays}`);

  if (!apply) {
    console.log('\nDRY RUN — pass --apply to write. Nothing has been changed.');
    return;
  }

  let centreId = existing[0]?.id;
  if (!centreId) {
    const [created] = await db.insert(centreT).values({ ...spec }).returning({ id: centreT.id });
    centreId = created!.id;
    console.log(`Created ${spec.name}`);
  }

  const result = await commitImport(
    { centreId, plan: await analyzeImport(centreId, readFileSync(file), db) },
    db,
  );
  console.log(
    `Imported: ${result.created} created, ${result.updated} updated, ` +
      `${result.unchanged} unchanged, ${result.skipped} skipped`,
  );

  for (const line of await createSharedStaff(db, spec.name)) console.log(`  ${line}`);

  const after = await db.execute(sql`
    SELECT (SELECT count(*) FROM student WHERE centre_id = ${centreId}) students,
           (SELECT count(*) FROM guardian WHERE centre_id = ${centreId}) guardians,
           (SELECT count(*) FROM "user" WHERE centre_id = ${centreId}) accounts`);
  console.log('AFTER:', JSON.stringify((after.rows ?? after)[0]));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
