import './load-env';
import { writeFile } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from './client';
import { runMigrations } from './migrate';
import {
  attendanceEvent,
  centre as centreT,
  complianceAttestation,
  credential as credentialT,
  guardian as guardianT,
  staffShift,
  student as studentT,
  studentGuardian,
  user as userT,
} from './schema';
import { hashPassword } from '../lib/auth/password';
import { generateToken, hashToken } from '../lib/credentials/token';
import { instantFromLocal, localDateString, addDays } from '../lib/time/centre-time';
import { expectedMinutesFor } from '../lib/students/expected-minutes';
import { DEMO_CREDENTIALS_PATH } from './demo-credentials';
import { SHARED_STAFF, createSharedStaff } from './shared-staff';
import { assertExclusive } from './pglite-lock';

const TIMEZONE = 'America/New_York';
const DAYS = 30;

/** Both centres are in the Cincinnati area, so both run on Eastern time. */
const CENTRES = [
  {
    name: 'Kumon of Mason West',
    timezone: TIMEZONE,
    phone: '+15135550142',
    closeTime: '19:00:00',
    instructor: { email: 'masonwest@centerline.test', name: 'Sandra Whitfield' },
    assistant: { email: 'masonwest.assistant@centerline.test', name: 'Devon Ruiz' },
    extraAssistants: [
      { email: 'masonwest.assistant2@centerline.test', name: 'Priya Nair' },
      { email: 'masonwest.assistant3@centerline.test', name: 'Tomas Alvarez' },
      { email: 'masonwest.assistant4@centerline.test', name: 'Grace Okonkwo' },
    ],
    students: 42,
    /** Left with open estimates and unconfirmed certifications, so the work shows. */
    tidy: false,
  },
  {
    name: 'Kumon of Liberty Township',
    timezone: TIMEZONE,
    phone: '+15135550188',
    closeTime: '18:30:00',
    instructor: { email: 'liberty@centerline.test', name: 'Anita Raghavan' },
    assistant: { email: 'liberty.assistant@centerline.test', name: 'Marcus Bell' },
    extraAssistants: [
      { email: 'liberty.assistant2@centerline.test', name: 'Hana Sato' },
      { email: 'liberty.assistant3@centerline.test', name: 'Elias Berg' },
      { email: 'liberty.assistant4@centerline.test', name: 'Nadia Haddad' },
    ],
    students: 36,
    /** Fully reconciled and certified, so /compliance reads all eight met. */
    tidy: true,
  },
] as const;

/** Override for a real deployment: SEED_PASSWORD=... pnpm db:seed */
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'password123';

const FIRST_NAMES = [
  'Aiden', 'Maya', 'Ethan', 'Sofia', 'Liam', 'Ava', 'Noah', 'Isabella', 'Lucas', 'Mia',
  'Oliver', 'Amelia', 'Elijah', 'Harper', 'James', 'Evelyn', 'Benjamin', 'Abigail', 'Sebastian',
  'Emily', 'Henry', 'Elizabeth', 'Alexander', 'Sofia', 'Daniel', 'Avery', 'Matthew', 'Ella',
  'Jackson', 'Scarlett', 'David', 'Grace', 'Joseph', 'Chloe', 'Samuel', 'Victoria', 'Owen',
  'Riley', 'John', 'Nora', 'Caleb', 'Layla',
];
const LAST_NAMES = [
  'Chen', 'Patel', 'Kim', 'Nguyen', 'Garcia', 'Smith', 'Johnson', 'Rodriguez', 'Lee', 'Martinez',
  'Wang', 'Sharma', 'Brown', 'Davis', 'Lopez', 'Singh', 'Wilson', 'Anderson', 'Taylor', 'Thomas',
];
const GUARDIAN_FIRST = ['Wei', 'Priya', 'Min', 'Linh', 'Carmen', 'Sarah', 'Michael', 'Elena', 'Grace', 'Ana'];

/** Deterministic PRNG so a reseed produces the same convincing demo. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type DemoCredential = {
  id: string;
  centreName: string;
  firstName: string;
  lastInitial: string;
  token: string;
};

async function seedCentre(
  db: Db,
  def: (typeof CENTRES)[number],
  seed: number,
): Promise<{ printable: DemoCredential[]; summary: string[] }> {
  const rand = mulberry32(seed);
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
  const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

  const [centre] = await db
    .insert(centreT)
    .values({
      name: def.name,
      timezone: def.timezone,
      phone: def.phone,
      closeTime: def.closeTime,
    })
    .returning();
  const centreId = centre!.id;

  const passwordHash = await hashPassword(SEED_PASSWORD);
  const insertedStaff = await db
    .insert(userT)
    .values([
      {
        centreId,
        email: def.instructor.email,
        passwordHash,
        role: 'instructor' as const,
        name: def.instructor.name,
      },
      {
        centreId,
        email: def.assistant.email,
        passwordHash,
        role: 'assistant' as const,
        name: def.assistant.name,
      },
      // Three more assistants per centre, so the floor has a staff of five and there
      // is somebody other than yourself to clock in, clock out and read on /staff.
      // Same password as everyone else — these are demo accounts, not stubs.
      ...def.extraAssistants.map((a) => ({
        centreId,
        email: a.email,
        passwordHash,
        role: 'assistant' as const,
        name: a.name,
      })),
    ])
    .returning();

  // Keyed by email rather than trusting RETURNING to come back in insertion order.
  const staffByEmail = new Map(insertedStaff.map((u) => [u.email, u]));
  const instructor = staffByEmail.get(def.instructor.email);
  const assistant = staffByEmail.get(def.assistant.email);
  const extraAssistants = def.extraAssistants.map((a) => staffByEmail.get(a.email)!);

  // ---- Students, guardians, credentials -----------------------------------
  const printable: DemoCredential[] = [];
  const studentIds: string[] = [];
  const expectedById = new Map<string, number>();

  for (let i = 0; i < def.students; i += 1) {
    const firstName = FIRST_NAMES[i % FIRST_NAMES.length]!;
    // Index 23 forces a shared first name + last initial, so the import review screen
    // has a genuine ambiguity to resolve.
    const lastName = i === 23 ? 'Chen' : pick(LAST_NAMES);
    const subjects = rand() < 0.35 ? ['Math', 'Reading'] : rand() < 0.5 ? ['Math'] : ['Reading'];
    const expectedMinutes = expectedMinutesFor(subjects);

    const [s] = await db
      .insert(studentT)
      .values({
        centreId,
        firstName,
        lastInitial: lastName[0]!.toUpperCase(),
        subjects,
        expectedMinutes,
        status: rand() < 0.05 ? 'inactive' : 'active',
        releaseMode: rand() < 0.2 ? 'self_release' : 'guardian_pickup',
        createdAt: new Date(Date.now() - between(40, 400) * 86_400_000),
      })
      .returning();
    const studentId = s!.id;
    studentIds.push(studentId);
    expectedById.set(studentId, expectedMinutes);

    // A tidy centre has a guardian and a phone number for everyone.
    const consent = def.tidy ? rand() < 0.95 : rand() < 0.85;
    const [g] = await db
      .insert(guardianT)
      .values({
        centreId,
        name: `${pick(GUARDIAN_FIRST)} ${lastName}`,
        phone: `+1513555${String(1000 + i).padStart(4, '0')}`,
        smsConsent: consent,
        smsConsentAt: consent ? new Date(Date.now() - between(30, 300) * 86_400_000) : null,
      })
      .returning();
    await db.insert(studentGuardian).values({ studentId, guardianId: g!.id, isPrimary: true });

    const token = generateToken();
    await db
      .insert(credentialT)
      .values({ centreId, studentId, kind: 'qr', tokenHash: hashToken(token) });
    printable.push({
      id: studentId,
      centreName: def.name,
      firstName,
      lastInitial: lastName[0]!.toUpperCase(),
      token,
    });
  }

  // Two siblings sharing one guardian, to demonstrate combined pickup messages.
  const [sibGuardian] = await db
    .insert(guardianT)
    .values({
      centreId,
      name: 'Hannah Okafor',
      phone: `+1513555${def.tidy ? '9922' : '9911'}`,
      smsConsent: true,
      smsConsentAt: new Date(),
    })
    .returning();
  for (const first of ['Zara', 'Kofi']) {
    const [s] = await db
      .insert(studentT)
      .values({
        centreId,
        firstName: first,
        lastInitial: 'O',
        subjects: ['Math'],
        expectedMinutes: 30,
        status: 'active',
      })
      .returning();
    studentIds.push(s!.id);
    expectedById.set(s!.id, 30);
    await db
      .insert(studentGuardian)
      .values({ studentId: s!.id, guardianId: sibGuardian!.id, isPrimary: true });
    const token = generateToken();
    await db
      .insert(credentialT)
      .values({ centreId, studentId: s!.id, kind: 'qr', tokenHash: hashToken(token) });
    printable.push({ id: s!.id, centreName: def.name, firstName: first, lastInitial: 'O', token });
  }

  // ---- Attendance over the last 30 days -----------------------------------
  const today = localDateString(new Date(), def.timezone);
  const events: (typeof attendanceEvent.$inferInsert)[] = [];
  let missingCheckouts = 0;
  let inferredCount = 0;

  const closeHour = Number(def.closeTime.slice(0, 2));
  const closeMinute = Number(def.closeTime.slice(3, 5));

  for (let d = DAYS; d >= 1; d -= 1) {
    const date = addDays(today, -d);
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (dow === 0) continue; // closed Sundays
    const isSessionDay = dow === 2 || dow === 4 || dow === 6; // Tue/Thu/Sat

    for (const studentId of studentIds) {
      const attends = isSessionDay ? rand() < 0.82 : rand() < 0.12;
      if (!attends) continue;

      const expected = expectedById.get(studentId)!;
      const checkIn = instantFromLocal(
        date,
        { hour: between(15, closeHour - 2), minute: between(0, 59) },
        def.timezone,
      );
      events.push({
        centreId,
        studentId,
        type: 'check_in',
        occurredAt: checkIn,
        captureMethod: rand() < 0.75 ? 'kiosk_qr' : rand() < 0.7 ? 'kiosk_tap' : 'staff',
      });

      if (rand() < 0.08) {
        // Forgot to check out. The hourly job closed it at closing time.
        missingCheckouts += 1;
        if (d > 2) {
          const closeAt = instantFromLocal(
            date,
            { hour: closeHour, minute: closeMinute },
            def.timezone,
          );
          events.push({
            centreId,
            studentId,
            type: 'check_out',
            occurredAt: closeAt,
            captureMethod: 'inferred',
            inferenceBasis: 'no activity after close',
          });
          inferredCount += 1;
        }
        continue;
      }

      const stay = Math.max(12, Math.round(expected * (0.7 + rand() * 0.85)));
      events.push({
        centreId,
        studentId,
        type: 'check_out',
        occurredAt: new Date(checkIn.getTime() + stay * 60_000),
        captureMethod: rand() < 0.8 ? 'kiosk_qr' : 'kiosk_tap',
      });
    }
  }

  // ---- Today: a live floor -------------------------------------------------
  const now = new Date();
  let presentCount = 0;
  for (const studentId of studentIds.slice(0, 14)) {
    if (rand() < 0.25) continue;
    const expected = expectedById.get(studentId)!;
    // Spread arrivals so the board shows green, amber and red timers at once.
    const minutesAgo = between(5, Math.round(expected * 1.6));
    events.push({
      centreId,
      studentId,
      type: 'check_in',
      occurredAt: new Date(now.getTime() - minutesAgo * 60_000),
      captureMethod: rand() < 0.8 ? 'kiosk_qr' : 'kiosk_tap',
    });
    presentCount += 1;
  }
  for (const studentId of studentIds.slice(14, 20)) {
    const inAt = new Date(now.getTime() - between(150, 300) * 60_000);
    events.push({ centreId, studentId, type: 'check_in', occurredAt: inAt, captureMethod: 'kiosk_qr' });
    events.push({
      centreId,
      studentId,
      type: 'check_out',
      occurredAt: new Date(inAt.getTime() + between(25, 70) * 60_000),
      captureMethod: 'kiosk_qr',
    });
  }

  events.sort((a, b) => (a.occurredAt as Date).getTime() - (b.occurredAt as Date).getTime());
  for (let i = 0; i < events.length; i += 200) {
    await db.insert(attendanceEvent).values(events.slice(i, i + 200));
  }

  // ---- Staff shifts --------------------------------------------------------
  // The last two weeks of afternoons, so /staff has something to read on a fresh
  // install. The untidy centre is left with an assistant still clocked in from
  // yesterday — the forgotten shift an instructor closes from that screen.
  //
  // Deliberately generated AFTER the attendance above: `rand()` is a seeded stream, so
  // drawing from it earlier shifts every student and every session that follows and the
  // demo data stops being reproducible.
  const shifts: (typeof staffShift.$inferInsert)[] = [];
  for (let back = 1; back <= 14; back += 1) {
    const dateStr = addDays(localDateString(new Date(), def.timezone), -back);
    const weekday = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
    if (weekday === 0) continue; // closed Sundays

    for (const person of [instructor!, assistant!, ...extraAssistants]) {
      // The two core staff are in every afternoon; the three extra assistants work a
      // rota, roughly one day in three. Four identical rows a day is not what a floor
      // looks like, and a log with gaps in it is the one worth reading.
      const rotaIndex = extraAssistants.indexOf(person);
      if (rotaIndex >= 0 && back % 3 !== rotaIndex) continue;

      const startHour = person.role === 'instructor' ? 13 : rotaIndex >= 0 ? 15 : 14;
      const started = instantFromLocal(dateStr, { hour: startHour, minute: 30 }, def.timezone);
      // Scoped to the named assistant, not to the role: with four assistants in the
      // centre, "any assistant, yesterday" would leave four forgotten shifts open
      // instead of the single one that screen is meant to demonstrate.
      const leftOpen = !def.tidy && back === 1 && person.id === assistant!.id;
      shifts.push({
        centreId,
        userId: person.id,
        startedAt: started,
        endedAt: leftOpen
          ? null
          : new Date(started.getTime() + between(4 * 60, 6 * 60) * 60_000),
      });
    }
  }
  await db.insert(staffShift).values(shifts);

  // ---- Reconciliation and certification ------------------------------------
  let confirmed = 0;
  if (def.tidy) {
    // A centre that keeps on top of its close-out: every estimate reviewed by staff.
    const open = await db.execute(sql`
      SELECT e.id, e.student_id, e.occurred_at
      FROM attendance_event e
      WHERE e.centre_id = ${centreId}
        AND e.capture_method = 'inferred'
        AND NOT EXISTS (SELECT 1 FROM attendance_event s WHERE s.supersedes_id = e.id)
    `);
    const rows = open.rows as { id: string; student_id: string; occurred_at: string }[];
    if (rows.length > 0) {
      await db.insert(attendanceEvent).values(
        rows.map((r) => ({
          centreId,
          studentId: r.student_id,
          type: 'check_out' as const,
          occurredAt: new Date(r.occurred_at),
          captureMethod: 'staff' as const,
          confirmedBy: instructor!.id,
          confirmedAt: new Date(),
          createdBy: instructor!.id,
          supersedesId: r.id,
        })),
      );
      confirmed = rows.length;
    }

    await db.insert(complianceAttestation).values([
      {
        centreId,
        requirementId: 'staff-oversight',
        confirmedBy: instructor!.id,
        confirmedByName: def.instructor.name,
        note: 'All assistants walked through the kiosk and close-out process at the start of term.',
      },
      {
        centreId,
        requirementId: 'backup-preservation',
        confirmedBy: instructor!.id,
        confirmedByName: def.instructor.name,
        note: 'Weekly CSV backup saved to the centre laptop; emergency roster printed and kept at the front desk.',
      },
    ]);
  }

  const summary = [
    `${def.name}`,
    `  ${insertedStaff.length} staff (1 instructor, ${insertedStaff.length - 1} assistants) · ${shifts.length} shifts over 14 days`,
    `  ${studentIds.length} students · ${events.length} attendance events over ${DAYS} days`,
    `  ${missingCheckouts} forgotten check-outs, ${inferredCount} closed by the hourly job`,
    def.tidy
      ? `  ${confirmed} estimates confirmed by staff · both annual certifications on file`
      : `  estimates left open for the Day screen · certifications not yet confirmed`,
    `  ${presentCount} students present right now`,
  ];

  return { printable, summary };
}

async function main() {
  // Seeding drops and rewrites every table. Doing that while a server holds the
  // same PGlite directory corrupts it, so check before touching anything.
  const raw = process.env.DATABASE_URL ?? 'file:./.pgdata';
  if ((process.env.DATABASE_DRIVER ?? 'pglite') === 'pglite' && raw.startsWith('file:')) {
    assertExclusive(raw.replace(/^file:/, ''));
  }

  const db = createDb();
  await runMigrations(db);

  console.log('Clearing existing demo data…');
  // attendance_event is append-only via trigger; TRUNCATE is DDL and bypasses it.
  // This is a seed-only reset, never something the application does.
  await db.execute(sql`TRUNCATE TABLE attendance_event, message_log, student_import_key,
    compliance_attestation, staff_shift, student_guardian, credential, student, guardian,
    "user", centre CASCADE`);

  const allPrintable: DemoCredential[] = [];
  const summaries: string[][] = [];

  for (const [i, def] of CENTRES.entries()) {
    const { printable, summary } = await seedCentre(db, def, 20260814 + i * 1000);
    allPrintable.push(...printable);
    summaries.push(summary);
  }

  await createSharedStaff(db);

  await writeFile(DEMO_CREDENTIALS_PATH, JSON.stringify(allPrintable, null, 2));

  console.log('');
  for (const summary of summaries) {
    for (const line of summary) console.log(line);
    console.log('');
  }

  console.log('Sign in at /login');
  for (const def of CENTRES) {
    console.log(`  ${def.name}`);
    console.log(`    ${def.instructor.email.padEnd(38)} ${SEED_PASSWORD}   instructor — sees everything`);
    console.log(`    ${def.assistant.email.padEnd(38)} ${SEED_PASSWORD}   assistant — kiosk, floor, emergency`);
    for (const extra of def.extraAssistants) {
      console.log(`    ${extra.email.padEnd(38)} ${SEED_PASSWORD}   assistant — ${extra.name}, on a rota`);
    }
    for (const shared of SHARED_STAFF.filter((s) => s.centreName === def.name)) {
      console.log(`    ${shared.email.padEnd(38)} $${shared.passwordEnvVar}   ${shared.role} — shared front-desk account`);
    }
  }
  console.log('');
  console.log('Kiosk test credentials (normally only on printed cards):');
  for (const def of CENTRES) {
    const sample = allPrintable.filter((p) => p.centreName === def.name).slice(0, 3);
    console.log(`  ${def.name}`);
    for (const p of sample) {
      console.log(`    ${`${p.firstName} ${p.lastInitial}.`.padEnd(12)} QR ${p.token}`);
    }
  }
  console.log('');
  console.log('  Full list in .demo-credentials.json. Print real cards from /students.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
