import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { addEvent, asDb, createTestDb, makeCentre, makeStudent, type TestDb } from './helpers/db';
import { attendanceEvent, credential as credentialT } from '@/db/schema';
import {
  EARLY_DEPARTURE_GRACE_PER_SUBJECT,
  earlyDepartureGrace,
  earlyDepartureThreshold,
  isEarlyDeparture,
} from '@/lib/attendance/early-departure';
import { toggleAttendance } from '@/lib/attendance/commands';
import { resolveCentreOpenSessions } from '@/lib/attendance/resolve';
import { presentStudents } from '@/lib/attendance/queries';
import { resolveScanAndToggle, resolveTapAndToggle } from '@/lib/kiosk/resolve';
import { generateToken, hashToken } from '@/lib/credentials/token';
import { instantFromLocal } from '@/lib/time/centre-time';

const TZ = 'America/New_York';
const DAY = '2026-05-12';
const at = (hour: number, minute: number, day = DAY) => instantFromLocal(day, { hour, minute }, TZ);

/**
 * The threshold, stated the way the centre states it: a one-subject student is expected
 * for 30 minutes with five minutes of grace, so the kiosk refuses before 25; two subjects
 * is 60 minutes with ten minutes of grace, so it refuses before 50.
 */
describe('the early-departure rule', () => {
  it('gives five minutes of grace per subject', () => {
    expect(EARLY_DEPARTURE_GRACE_PER_SUBJECT).toBe(5);
    expect(earlyDepartureGrace(30)).toBe(5);
    expect(earlyDepartureGrace(60)).toBe(10);
    expect(earlyDepartureGrace(90)).toBe(15);
    expect(earlyDepartureThreshold(30)).toBe(25);
    expect(earlyDepartureThreshold(60)).toBe(50);
  });

  it('holds a one-subject student to 25 minutes', () => {
    expect(isEarlyDeparture(24, 30)).toBe(true);
    expect(isEarlyDeparture(25, 30)).toBe(false);
    expect(isEarlyDeparture(29, 30)).toBe(false);
    expect(isEarlyDeparture(45, 30)).toBe(false);
  });

  it('holds a two-subject student to 50 minutes', () => {
    expect(isEarlyDeparture(49, 60)).toBe(true);
    expect(isEarlyDeparture(50, 60)).toBe(false);
    expect(isEarlyDeparture(59, 60)).toBe(false);
  });

  /** An allowance an import set to something that is not a clean multiple of 30. */
  it('rounds an odd allowance to the nearest whole subject', () => {
    expect(earlyDepartureGrace(45)).toBe(10);
    expect(isEarlyDeparture(34, 45)).toBe(true);
    expect(isEarlyDeparture(35, 45)).toBe(false);
  });

  /** Nobody gets trapped at the door by an allowance that was never set. */
  it('never blocks a student with no allowance to fall short of', () => {
    expect(isEarlyDeparture(1, 0)).toBe(false);
  });
});

describe('the kiosk refusing an early check-out', () => {
  let db: TestDb;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    ({ db, cleanup } = await createTestDb());
  });
  afterAll(() => cleanup());

  async function eventsFor(studentId: string) {
    return db
      .select()
      .from(attendanceEvent)
      .where(eq(attendanceEvent.studentId, studentId));
  }

  /** A student who arrived at 3:30pm and is still in the building. */
  async function present(expectedMinutes: number, subjects = ['Math']) {
    const centre = await makeCentre(db, { timezone: TZ, name: 'Liberty' });
    const student = await makeStudent(db, centre.id, {
      firstName: 'Ava',
      lastInitial: 'R',
      subjects,
      expectedMinutes,
    });
    await addEvent(db, {
      centreId: centre.id,
      studentId: student.id,
      type: 'check_in',
      occurredAt: at(15, 30),
    });
    return { centre, student };
  }

  it('says not yet, and records nothing, when a one-subject student taps at 24 minutes', async () => {
    const { centre, student } = await present(30);

    const outcome = await resolveTapAndToggle(
      { centre, studentId: student.id, at: at(15, 54) },
      asDb(db),
    );

    expect(outcome).toEqual({
      ok: false,
      tooEarly: true,
      firstName: 'Ava',
      lastInitial: 'R',
    });

    // The refusal is not an event. The log says they are still here, because they are.
    const events = await eventsFor(student.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('check_in');
    const onFloor = await presentStudents(centre.id, TZ, at(15, 55), asDb(db));
    expect(onFloor.map((s) => s.studentId)).toEqual([student.id]);
  });

  it('lets a one-subject student go at exactly 25 minutes', async () => {
    const { centre, student } = await present(30);

    const outcome = await resolveTapAndToggle(
      { centre, studentId: student.id, at: at(15, 55) },
      asDb(db),
    );

    expect(outcome).toMatchObject({ ok: true, action: 'check_out', durationMinutes: 25 });
    expect(await eventsFor(student.id)).toHaveLength(2);
  });

  it('holds a two-subject student until 50 minutes', async () => {
    const early = await present(60, ['Math', 'Reading']);
    const onTime = await present(60, ['Math', 'Reading']);

    expect(
      await resolveTapAndToggle(
        { centre: early.centre, studentId: early.student.id, at: at(16, 19) },
        asDb(db),
      ),
    ).toMatchObject({ ok: false, tooEarly: true });
    expect(
      await resolveTapAndToggle(
        { centre: onTime.centre, studentId: onTime.student.id, at: at(16, 20) },
        asDb(db),
      ),
    ).toMatchObject({ ok: true, action: 'check_out', durationMinutes: 50 });
  });

  it('refuses a scanned card the same way it refuses a tap', async () => {
    const { centre, student } = await present(30);
    const token = generateToken();
    await db.insert(credentialT).values({
      centreId: centre.id,
      studentId: student.id,
      kind: 'qr',
      tokenHash: hashToken(token),
    });

    const outcome = await resolveScanAndToggle({ centre, token, at: at(15, 40) }, asDb(db));

    expect(outcome).toMatchObject({ ok: false, tooEarly: true, firstName: 'Ava' });
    expect(await eventsFor(student.id)).toHaveLength(1);
  });

  /** The rule is about leaving. Arriving is never blocked, however short the day. */
  it('never blocks a check-in', async () => {
    const centre = await makeCentre(db, { timezone: TZ });
    const student = await makeStudent(db, centre.id, { expectedMinutes: 60 });

    const outcome = await resolveTapAndToggle(
      { centre, studentId: student.id, at: at(18, 25) },
      asDb(db),
    );

    expect(outcome).toMatchObject({ ok: true, action: 'check_in' });
  });

  /**
   * A child who has just checked in and taps again is inside the double-scan window.
   * They get "Already checked in" — true, and more use to them than "not yet".
   */
  it('leaves the double-scan grace window to the toggle rule', async () => {
    const centre = await makeCentre(db, { timezone: TZ });
    const student = await makeStudent(db, centre.id, { expectedMinutes: 30 });
    await addEvent(db, {
      centreId: centre.id,
      studentId: student.id,
      type: 'check_in',
      occurredAt: at(15, 30),
    });

    const outcome = await resolveTapAndToggle(
      { centre, studentId: student.id, at: new Date(at(15, 30).getTime() + 10_000) },
      asDb(db),
    );

    expect(outcome).toMatchObject({ ok: true, action: 'check_in', repeated: true });
  });

  it('never blocks a student whose allowance was never set', async () => {
    const centre = await makeCentre(db, { timezone: TZ });
    const student = await makeStudent(db, centre.id, { expectedMinutes: 0 });
    await addEvent(db, {
      centreId: centre.id,
      studentId: student.id,
      type: 'check_in',
      occurredAt: at(15, 30),
    });

    expect(
      await resolveTapAndToggle({ centre, studentId: student.id, at: at(15, 35) }, asDb(db)),
    ).toMatchObject({ ok: true, action: 'check_out' });
  });

  /**
   * The block lives in the kiosk layer, not in the attendance log. Staff have to be able
   * to release a student early — a guardian collecting for a dentist appointment is not a
   * situation a tablet gets to veto — so /floor's Check out button, which records the
   * event directly, is unaffected.
   */
  it('does not stop staff from checking a student out early', async () => {
    const { centre, student } = await present(30);

    const result = await toggleAttendance(
      {
        studentId: student.id,
        centreId: centre.id,
        timezone: TZ,
        captureMethod: 'staff',
        at: at(15, 40),
      },
      asDb(db),
    );

    expect(result).toMatchObject({ action: 'check_out', durationMinutes: 10 });
  });

  /**
   * Nor does it change what the nightly sweep does with a session nobody closed. That
   * check-out is an estimate stamped at closing time, and the sweep is what stops a
   * forgotten session staying open for ever.
   */
  it('does not stop the inferred sweep from closing a short session', async () => {
    const centre = await makeCentre(db, { timezone: TZ });
    const student = await makeStudent(db, centre.id, { expectedMinutes: 30 });
    await addEvent(db, {
      centreId: centre.id,
      studentId: student.id,
      type: 'check_in',
      occurredAt: at(18, 55),
    });

    const result = await resolveCentreOpenSessions(
      { id: centre.id, name: centre.name, timezone: TZ, close_time: '19:00:00' },
      at(20, 5),
      asDb(db),
    );

    expect(result.inserted).toBe(1);
  });
});
