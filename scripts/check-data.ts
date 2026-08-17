/**
 * Sanity-checks the seeded demo data. Run against a stopped server:
 *   pnpm check:data
 *
 * Exists because "the synthetic data looks wrong" is hard to answer by eye — this
 * asserts the properties that make the demo believable and the app correct.
 */
import '../db/load-env';
import { sql } from 'drizzle-orm';
import { createDb } from '../db/client';

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  OK   ${label}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
}

async function main() {
  const db = createDb();
  const one = async (q: ReturnType<typeof sql>) =>
    (await db.execute(q)).rows[0] as Record<string, unknown>;
  const all = async (q: ReturnType<typeof sql>) =>
    (await db.execute(q)).rows as Record<string, unknown>[];

  console.log('\nCentres');
  const centres = await all(sql`
    SELECT c.id, c.name, c.timezone, c.close_time::text AS close_time,
      (SELECT count(*)::int FROM student s WHERE s.centre_id = c.id) students,
      (SELECT count(*)::int FROM "user" u WHERE u.centre_id = c.id) users
    FROM centre c ORDER BY c.name`);
  check('two centres exist', centres.length === 2, centres.map((c) => c.name).join(' + '));
  for (const c of centres) {
    check(`${c.name}: has students and staff`,
      Number(c.students) > 0 && Number(c.users) === 2,
      `${c.students} students, ${c.users} users, closes ${c.close_time}`);
  }

  console.log('\nIntegrity');
  const future = await one(sql`SELECT count(*)::int n FROM attendance_event WHERE occurred_at > now()`);
  check('no attendance recorded in the future', Number(future.n) === 0, `${future.n} found`);

  const dur = await one(sql`
    SELECT count(*) FILTER (WHERE duration_minutes < 0)::int neg,
           max(duration_minutes)::int longest
    FROM session_v WHERE NOT is_open`);
  check('no negative session durations', Number(dur.neg) === 0);
  // A long session is legitimate only when the departure was estimated at closing time.
  const longObserved = await one(sql`
    SELECT count(*)::int n FROM session_v
    WHERE NOT is_open AND duration_minutes > 360 AND NOT is_estimated`);
  check('no implausibly long observed session', Number(longObserved.n) === 0,
    `longest overall ${dur.longest}m (estimates may be long by design)`);

  const cross = await one(sql`
    SELECT
      (SELECT count(*)::int FROM attendance_event e JOIN student s ON s.id = e.student_id
        WHERE s.centre_id <> e.centre_id) events,
      (SELECT count(*)::int FROM session_v v JOIN student s ON s.id = v.student_id
        WHERE s.centre_id <> v.centre_id) sessions`);
  check('no record crosses centres', Number(cross.events) === 0 && Number(cross.sessions) === 0);

  const orphan = await one(sql`
    SELECT
      (SELECT count(*)::int FROM student s WHERE s.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM student_guardian g WHERE g.student_id = s.id)) no_guardian,
      (SELECT count(*)::int FROM student s WHERE s.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM credential c WHERE c.student_id = s.id AND c.revoked_at IS NULL)) no_card`);
  check('every active student has a guardian', Number(orphan.no_guardian) === 0, `${orphan.no_guardian} without`);
  check('every active student has a QR card', Number(orphan.no_card) === 0, `${orphan.no_card} without`);

  const pins = await one(sql`SELECT count(*)::int n FROM credential WHERE kind = 'pin'`);
  check('no PIN credentials remain', Number(pins.n) === 0, `${pins.n} found`);
  const pinEvents = await one(sql`SELECT count(*)::int n FROM attendance_event WHERE capture_method = 'kiosk_pin'`);
  check('seed produces no kiosk_pin events', Number(pinEvents.n) === 0, `${pinEvents.n} found`);

  console.log('\nThe demo actually demonstrates something');
  for (const c of centres) {
    const s = await one(sql`
      SELECT
        (SELECT count(*)::int FROM session_v v WHERE v.centre_id = ${c.id}
          AND v.is_open AND v.session_date = (now() AT TIME ZONE ${c.timezone})::date) present,
        (SELECT count(*)::int FROM session_v v WHERE v.centre_id = ${c.id}
          AND v.check_out_method = 'inferred') open_estimates,
        (SELECT count(*)::int FROM compliance_attestation a WHERE a.centre_id = ${c.id}) attestations,
        (SELECT count(DISTINCT session_date)::int FROM session_v v WHERE v.centre_id = ${c.id}) days`);
    check(`${c.name}: students on the floor now`, Number(s.present) > 0, `${s.present} present`);
    check(`${c.name}: has attendance history`, Number(s.days) >= 20, `${s.days} days`);
    console.log(`       ${s.open_estimates} unconfirmed estimate(s), ${s.attestations} certification(s)`);
  }

  const methods = await all(sql`
    SELECT capture_method m, count(*)::int n FROM attendance_event GROUP BY 1 ORDER BY 2 DESC`);
  console.log(`\n  capture methods: ${methods.map((m) => `${m.m}=${m.n}`).join(', ')}`);

  console.log(`\n${'='.repeat(56)}\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
