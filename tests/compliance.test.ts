import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  addEvent,
  asDb,
  createTestDb,
  makeCentre,
  makeGuardian,
  makeStudent,
  makeUser,
  type TestDb,
} from './helpers/db';
import { complianceAttestation, credential } from '@/db/schema';
import {
  ATTESTATION_VALID_MONTHS,
  REQUIREMENTS,
  evaluateRequirements,
  type Attestation,
} from '@/lib/compliance/requirements';
import { hashToken } from '@/lib/credentials/token';
import { resolveOpenSessions } from '@/lib/attendance/resolve';
import { confirmInferredCheckOut } from '@/lib/attendance/commands';
import { instantFromLocal, localDateString } from '@/lib/time/centre-time';

const TZ = 'America/New_York';

/** A centre with credentialled students and a few days of clean attendance. */
async function seedWorkingCentre(db: TestDb, name = 'Kumon Test') {
  const centre = await makeCentre(db, { name, timezone: TZ, closeTime: '19:00:00' });
  const user = await makeUser(db, centre.id);
  const students = [];
  for (const first of ['Aiden', 'Maya', 'Ethan']) {
    const s = await makeStudent(db, centre.id, { firstName: first });
    await makeGuardian(db, centre.id, s.id);
    await db
      .insert(credential)
      .values({ centreId: centre.id, studentId: s.id, kind: 'qr', tokenHash: hashToken(`tok-${s.id}`) });
    students.push(s);
  }

  const day = '2026-05-12';
  for (const s of students) {
    await addEvent(db, {
      centreId: centre.id, studentId: s.id, type: 'check_in',
      occurredAt: instantFromLocal(day, { hour: 15, minute: 30 }, TZ),
    });
    await addEvent(db, {
      centreId: centre.id, studentId: s.id, type: 'check_out',
      occurredAt: instantFromLocal(day, { hour: 16, minute: 30 }, TZ),
    });
  }
  return { centre, user, students, day };
}

function ctxFor(centre: Awaited<ReturnType<typeof makeCentre>>, day: string, attestations: Attestation[] = []) {
  return { centre, from: day, to: day, attestations };
}

describe('Kumon baseline requirements', () => {
  let db: TestDb;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    ({ db, cleanup } = await createTestDb());
  });
  afterAll(() => cleanup());

  it('covers all eight requirements from the checklist', () => {
    expect(REQUIREMENTS).toHaveLength(8);
    expect(REQUIREMENTS.map((r) => r.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(REQUIREMENTS.map((r) => r.title)).toEqual([
      'Digital System Required',
      'Unique Student Identification',
      'Actual Arrival and Departure',
      'Staff Oversight and Training',
      'Current Student Awareness',
      'Backup or Data Preservation Approach',
      'Appropriate Handling of Student Information / Personally Identifiable Information (PII)',
      'Reviewable and Retained Records',
    ]);
    // Every row must carry the checklist wording so a reviewer sees the requirement itself.
    for (const r of REQUIREMENTS) expect(r.confirmation.length).toBeGreaterThan(40);
  });

  it('reports a working, reconciled, certified centre as fully compliant', async () => {
    const { centre, day } = await seedWorkingCentre(db, 'Kumon Tidy');
    const attestations: Attestation[] = [
      { requirementId: 'staff-oversight', confirmedByName: 'Sandra', confirmedAt: new Date() },
      { requirementId: 'backup-preservation', confirmedByName: 'Sandra', confirmedAt: new Date() },
    ];
    const results = await evaluateRequirements(ctxFor(centre, day, attestations), asDb(db));
    const amber = results.filter((r) => r.status === 'amber');
    expect(amber.map((r) => r.title)).toEqual([]);
  });

  it('flags requirement 2 when a student cannot identify themselves', async () => {
    const { centre, day } = await seedWorkingCentre(db, 'Kumon NoCred');
    // A student with no credential cannot use the kiosk at all.
    await makeStudent(db, centre.id, { firstName: 'Uncarded' });

    const results = await evaluateRequirements(ctxFor(centre, day), asDb(db));
    const req2 = results.find((r) => r.number === 2)!;
    expect(req2.status).toBe('amber');
    expect(req2.evidence).toMatch(/no usable QR card/i);
  });

  it('flags requirement 3 while an estimated departure is unreviewed, and clears it once confirmed', async () => {
    const centre = await makeCentre(db, { name: 'Kumon Estimates', timezone: TZ, closeTime: '19:00:00' });
    const user = await makeUser(db, centre.id);
    const student = await makeStudent(db, centre.id);
    await db.insert(credential).values({
      centreId: centre.id, studentId: student.id, kind: 'qr', tokenHash: hashToken('t'),
    });

    const day = localDateString(new Date(), TZ);
    await addEvent(db, {
      centreId: centre.id, studentId: student.id, type: 'check_in',
      occurredAt: instantFromLocal(day, { hour: 15, minute: 0 }, TZ),
    });
    await resolveOpenSessions(instantFromLocal(day, { hour: 20, minute: 30 }, TZ), asDb(db));

    const before = await evaluateRequirements(ctxFor(centre, day), asDb(db));
    const req3Before = before.find((r) => r.number === 3)!;
    expect(req3Before.status).toBe('amber');
    expect(req3Before.evidence).toMatch(/awaiting staff confirmation/i);

    const inferred = (
      await db.execute(sql`
        SELECT id, occurred_at FROM attendance_event
        WHERE student_id = ${student.id} AND capture_method = 'inferred'
      `)
    ).rows[0] as { id: string; occurred_at: string };

    await confirmInferredCheckOut(
      {
        inferredEventId: inferred.id,
        centreId: centre.id,
        studentId: student.id,
        occurredAt: new Date(inferred.occurred_at),
        confirmedBy: user.id,
      },
      asDb(db),
    );

    const after = await evaluateRequirements(ctxFor(centre, day), asDb(db));
    expect(after.find((r) => r.number === 3)!.status).toBe('green');
  });

  it('treats the two attested requirements as unmet until someone confirms them', async () => {
    const { centre, day } = await seedWorkingCentre(db, 'Kumon Unattested');
    const results = await evaluateRequirements(ctxFor(centre, day), asDb(db));

    for (const number of [4, 6]) {
      const r = results.find((x) => x.number === number)!;
      expect(r.kind).toBe('attested');
      expect(r.status).toBe('amber');
      expect(r.measure).toBe('not yet confirmed');
    }
  });

  it('expires an annual certification after twelve months', async () => {
    const { centre, day } = await seedWorkingCentre(db, 'Kumon Lapsed');

    const stale = new Date();
    stale.setMonth(stale.getMonth() - (ATTESTATION_VALID_MONTHS + 1));
    const fresh: Attestation[] = [
      { requirementId: 'staff-oversight', confirmedByName: 'Sandra', confirmedAt: stale },
      { requirementId: 'backup-preservation', confirmedByName: 'Sandra', confirmedAt: new Date() },
    ];

    const results = await evaluateRequirements(ctxFor(centre, day, fresh), asDb(db));
    expect(results.find((r) => r.number === 4)!.status).toBe('amber');
    expect(results.find((r) => r.number === 4)!.measure).toMatch(/expired/);
    expect(results.find((r) => r.number === 6)!.status).toBe('green');
  });

  it('reports requirement 8 as met because the log is immutable', async () => {
    const { centre, day } = await seedWorkingCentre(db, 'Kumon Retention');
    const results = await evaluateRequirements(ctxFor(centre, day), asDb(db));
    const req8 = results.find((r) => r.number === 8)!;
    expect(req8.status).toBe('green');
    expect(req8.evidence).toMatch(/never edited or deleted/i);
    // The checklist requires at least two years. Records are never purged, so the
    // wording must claim retention beyond that minimum rather than a deletion window.
    expect(req8.evidence).toMatch(/two-year minimum/i);
    expect(req8.evidence).not.toMatch(/deleted after|retained for only/i);
  });

  it('confirms requirement 7 sees credentials stored one-way', async () => {
    const { centre, day } = await seedWorkingCentre(db, 'Kumon PII');
    const results = await evaluateRequirements(ctxFor(centre, day), asDb(db));
    const req7 = results.find((r) => r.number === 7)!;
    expect(req7.status).toBe('green');
    expect(req7.evidence).toMatch(/one-way hashes/i);

    // A short, recoverable token is exactly what this requirement should catch.
    const student = await makeStudent(db, centre.id, { firstName: 'Leaky' });
    await db.insert(credential).values({
      centreId: centre.id, studentId: student.id, kind: 'qr', tokenHash: '1234',
    });
    const after = await evaluateRequirements(ctxFor(centre, day), asDb(db));
    expect(after.find((r) => r.number === 7)!.status).toBe('amber');
  });
});

describe('centre isolation', () => {
  let db: TestDb;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    ({ db, cleanup } = await createTestDb());
  });
  afterAll(() => cleanup());

  it('keeps two centres’ compliance and attendance entirely separate', async () => {
    const a = await seedWorkingCentre(db, 'Kumon of Mason West');
    const b = await seedWorkingCentre(db, 'Kumon of Liberty Township');

    // Certify one centre only.
    await db.insert(complianceAttestation).values([
      {
        centreId: b.centre.id,
        requirementId: 'staff-oversight',
        confirmedBy: b.user.id,
        confirmedByName: 'Anita',
      },
    ]);

    const attestations = [
      { requirementId: 'staff-oversight', confirmedByName: 'Anita', confirmedAt: new Date() },
    ];
    const aResults = await evaluateRequirements(ctxFor(a.centre, a.day), asDb(db));
    const bResults = await evaluateRequirements(ctxFor(b.centre, b.day, attestations), asDb(db));

    expect(aResults.find((r) => r.number === 4)!.status).toBe('amber');
    expect(bResults.find((r) => r.number === 4)!.status).toBe('green');

    // Each centre counts only its own students and records.
    const aReq2 = aResults.find((r) => r.number === 2)!;
    const bReq2 = bResults.find((r) => r.number === 2)!;
    expect(aReq2.measure).toBe('3 of 3 active students');
    expect(bReq2.measure).toBe('3 of 3 active students');

    // And no session ever pairs events across centres.
    const crossed = await db.execute(sql`
      SELECT count(*)::int n FROM session_v v
      JOIN student s ON s.id = v.student_id
      WHERE s.centre_id <> v.centre_id
    `);
    expect((crossed.rows[0] as { n: number }).n).toBe(0);
  });
});
