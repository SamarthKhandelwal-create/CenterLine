import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { addEvent, asDb, createTestDb, makeCentre, makeStudent, type TestDb } from './helpers/db';
import { recordEvent, toggleAttendance } from '@/lib/attendance/commands';
import { resolveTapAndToggle } from '@/lib/kiosk/resolve';
import { lastEventOnLocalDay, presentStudents } from '@/lib/attendance/queries';
import { instantFromLocal } from '@/lib/time/centre-time';

/**
 * THE RULE: a student never chooses check-in vs check-out. If they have an open
 * session today it is a check-out; otherwise a check-in.
 */
describe('check-in / check-out inference rule', () => {
  let db: TestDb;
  let cleanup: () => Promise<void>;
  const TZ = 'America/New_York';

  beforeAll(async () => {
    ({ db, cleanup } = await createTestDb());
  });
  afterAll(() => cleanup());

  it('checks a student IN when they have no events today', async () => {
    const centre = await makeCentre(db, { timezone: TZ });
    const student = await makeStudent(db, centre.id);

    const result = await toggleAttendance(
      {
        studentId: student.id,
        centreId: centre.id,
        timezone: TZ,
        captureMethod: 'kiosk_qr',
        at: instantFromLocal('2026-05-12', { hour: 15, minute: 30 }, TZ),
      },
      asDb(db),
    );

    expect(result.action).toBe('check_in');
    expect(result.deduplicated).toBe(false);
  });

  it('checks a student OUT when a session is already open', async () => {
    const centre = await makeCentre(db, { timezone: TZ });
    const student = await makeStudent(db, centre.id);
    await addEvent(db, {
      centreId: centre.id,
      studentId: student.id,
      type: 'check_in',
      occurredAt: instantFromLocal('2026-05-12', { hour: 15, minute: 0 }, TZ),
    });

    const result = await toggleAttendance(
      {
        studentId: student.id,
        centreId: centre.id,
        timezone: TZ,
        captureMethod: 'kiosk_qr',
        at: instantFromLocal('2026-05-12', { hour: 16, minute: 0 }, TZ),
      },
      asDb(db),
    );

    expect(result.action).toBe('check_out');
    expect(result.durationMinutes).toBe(60);
  });

  it('checks a student back IN after a completed session the same day', async () => {
    const centre = await makeCentre(db, { timezone: TZ });
    const student = await makeStudent(db, centre.id);
    await addEvent(db, {
      centreId: centre.id, studentId: student.id, type: 'check_in',
      occurredAt: instantFromLocal('2026-05-12', { hour: 15, minute: 0 }, TZ),
    });
    await addEvent(db, {
      centreId: centre.id, studentId: student.id, type: 'check_out',
      occurredAt: instantFromLocal('2026-05-12', { hour: 16, minute: 0 }, TZ),
    });

    const result = await toggleAttendance(
      {
        studentId: student.id, centreId: centre.id, timezone: TZ,
        captureMethod: 'kiosk_qr',
        at: instantFromLocal('2026-05-12', { hour: 17, minute: 0 }, TZ),
      },
      asDb(db),
    );

    expect(result.action).toBe('check_in');
  });

  it('treats yesterday as a different day, even across the UTC date boundary', async () => {
    const centre = await makeCentre(db, { timezone: 'America/Los_Angeles' });
    const student = await makeStudent(db, centre.id);

    // 19:00 local on the 11th is 02:00 UTC on the 12th. A naive UTC-based
    // implementation would call this "today" and check the student out.
    await addEvent(db, {
      centreId: centre.id, studentId: student.id, type: 'check_in',
      occurredAt: instantFromLocal('2026-05-11', { hour: 19, minute: 0 }, 'America/Los_Angeles'),
    });

    const result = await toggleAttendance(
      {
        studentId: student.id, centreId: centre.id, timezone: 'America/Los_Angeles',
        captureMethod: 'kiosk_qr',
        at: instantFromLocal('2026-05-12', { hour: 15, minute: 0 }, 'America/Los_Angeles'),
      },
      asDb(db),
    );

    expect(result.action).toBe('check_in');
  });

  it('ignores a superseded event and toggles from the correction', async () => {
    const centre = await makeCentre(db, { timezone: TZ });
    const student = await makeStudent(db, centre.id);

    const wrong = await addEvent(db, {
      centreId: centre.id, studentId: student.id, type: 'check_in',
      occurredAt: instantFromLocal('2026-05-12', { hour: 15, minute: 0 }, TZ),
    });
    // Correction: the check-in never happened.
    await addEvent(db, {
      centreId: centre.id, studentId: student.id, type: 'check_in',
      occurredAt: instantFromLocal('2026-05-12', { hour: 15, minute: 0 }, TZ),
      captureMethod: 'manual',
      inferenceBasis: 'voided',
      supersedesId: wrong.id,
    });

    const last = await lastEventOnLocalDay(
      student.id, TZ,
      instantFromLocal('2026-05-12', { hour: 16, minute: 0 }, TZ),
      asDb(db),
    );
    expect(last).toBeNull();

    const result = await toggleAttendance(
      {
        studentId: student.id, centreId: centre.id, timezone: TZ,
        captureMethod: 'kiosk_qr',
        at: instantFromLocal('2026-05-12', { hour: 16, minute: 0 }, TZ),
      },
      asDb(db),
    );
    expect(result.action).toBe('check_in');
  });

  it('does not flip a student who taps twice within the grace window', async () => {
    const centre = await makeCentre(db, { timezone: TZ });
    const student = await makeStudent(db, centre.id);
    const at = instantFromLocal('2026-05-12', { hour: 15, minute: 0 }, TZ);

    const first = await toggleAttendance(
      { studentId: student.id, centreId: centre.id, timezone: TZ, captureMethod: 'kiosk_qr', at },
      asDb(db),
    );
    const second = await toggleAttendance(
      {
        studentId: student.id, centreId: centre.id, timezone: TZ, captureMethod: 'kiosk_qr',
        at: new Date(at.getTime() + 5_000),
      },
      asDb(db),
    );

    expect(first.action).toBe('check_in');
    expect(second.action).toBe('check_in');
    expect(second.deduplicated).toBe(true);

    const count = await db.execute(sql`
      SELECT count(*)::int n FROM attendance_event WHERE student_id = ${student.id}
    `);
    expect((count.rows[0] as { n: number }).n).toBe(1);
  });

  it('tells the kiosk when a result was replayed rather than recorded', async () => {
    const centre = await makeCentre(db, { timezone: TZ });
    const student = await makeStudent(db, centre.id);
    const at = instantFromLocal('2026-05-12', { hour: 15, minute: 0 }, TZ);

    // Staff check the student in at the desk; the child walks over and taps their tile,
    // which reads "Check out" because they are present.
    await recordEvent(
      {
        studentId: student.id, centreId: centre.id, type: 'check_in',
        occurredAt: at, captureMethod: 'staff',
      },
      asDb(db),
    );

    const tooSoon = await resolveTapAndToggle(
      { centre, studentId: student.id, at: new Date(at.getTime() + 15_000) },
      asDb(db),
    );
    // Inside the grace window nothing is recorded and the previous result comes back.
    // `repeated` is what stops the screen answering "Checked in" to a tile that said
    // Check out, which reads as the kiosk refusing to let the student leave.
    expect(tooSoon).toMatchObject({ ok: true, action: 'check_in', repeated: true });

    // Once past the grace window a real check-out is recorded. Timed at 26 minutes
    // rather than 26 seconds because the kiosk also refuses to end a session that has
    // not run its allowance — see tests/early-departure.test.ts.
    const afterGrace = await resolveTapAndToggle(
      { centre, studentId: student.id, at: new Date(at.getTime() + 26 * 60_000) },
      asDb(db),
    );
    expect(afterGrace).toMatchObject({ ok: true, action: 'check_out', repeated: false });
  });

  it('collapses a doubled check-in into one open session', async () => {
    const centre = await makeCentre(db, { timezone: TZ });
    const student = await makeStudent(db, centre.id);
    const base = instantFromLocal('2026-05-12', { hour: 15, minute: 0 }, TZ);
    await addEvent(db, { centreId: centre.id, studentId: student.id, type: 'check_in', occurredAt: base });
    await addEvent(db, {
      centreId: centre.id, studentId: student.id, type: 'check_in',
      occurredAt: new Date(base.getTime() + 60_000),
    });

    const present = await presentStudents(
      centre.id, TZ, new Date(base.getTime() + 30 * 60_000), asDb(db),
    );
    expect(present).toHaveLength(1);
    // The session starts at the FIRST scan, which is the honest reading.
    expect(present[0]!.checkInAt.getTime()).toBe(base.getTime());
  });
});

describe('append-only guarantee', () => {
  let db: TestDb;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    ({ db, cleanup } = await createTestDb());
  });
  afterAll(() => cleanup());

  it('rejects UPDATE and DELETE on attendance_event at the database level', async () => {
    const centre = await makeCentre(db);
    const student = await makeStudent(db, centre.id);
    const event = await addEvent(db, {
      centreId: centre.id, studentId: student.id, type: 'check_in', occurredAt: new Date(),
    });

    // Drizzle wraps the driver error, so inspect the whole chain for the trigger's message.
    const messageChain = (err: unknown): string => {
      const parts: string[] = [];
      let cur: unknown = err;
      while (cur && typeof cur === 'object') {
        const e = cur as { message?: string; cause?: unknown };
        if (e.message) parts.push(e.message);
        cur = e.cause;
      }
      return parts.join(' | ');
    };

    const update = await db
      .execute(sql`UPDATE attendance_event SET type = 'check_out' WHERE id = ${event.id}`)
      .then(() => null)
      .catch((e: unknown) => e);
    expect(update, 'UPDATE must be rejected').not.toBeNull();
    expect(messageChain(update)).toMatch(/append-only/i);

    const del = await db
      .execute(sql`DELETE FROM attendance_event WHERE id = ${event.id}`)
      .then(() => null)
      .catch((e: unknown) => e);
    expect(del, 'DELETE must be rejected').not.toBeNull();
    expect(messageChain(del)).toMatch(/append-only/i);

    // And the row is still there.
    const still = await db.execute(sql`SELECT count(*)::int n FROM attendance_event WHERE id = ${event.id}`);
    expect((still.rows[0] as { n: number }).n).toBe(1);
  });
});
