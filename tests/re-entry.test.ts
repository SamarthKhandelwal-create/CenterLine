import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { addEvent, asDb, createTestDb, makeCentre, makeStudent, type TestDb } from './helpers/db';
import { attendanceEvent } from '@/db/schema';
import {
  RE_ENTRY_FRACTION,
  isReEntryBlocked,
  reEntryThreshold,
} from '@/lib/attendance/time-used';
import { minutesUsedToday, minutesUsedTodayByStudent } from '@/lib/attendance/queries';
import { resolveTapAndToggle } from '@/lib/kiosk/resolve';
import { instantFromLocal } from '@/lib/time/centre-time';

const TZ = 'America/New_York';
const DAY = '2026-05-12';
const at = (hour: number, minute: number, day = DAY) => instantFromLocal(day, { hour, minute }, TZ);

/**
 * The rule as the centre states it: once a student has spent more than half their daily
 * allowance, the kiosk stops letting them back in. A 30-minute student is closed out
 * after 16 minutes; at exactly 15 they are at half, not past it, and may still come in.
 */
describe('the re-entry rule', () => {
  it('puts the threshold at half the allowance', () => {
    expect(RE_ENTRY_FRACTION).toBe(0.5);
    expect(reEntryThreshold(30)).toBe(15);
    expect(reEntryThreshold(60)).toBe(30);
    expect(reEntryThreshold(90)).toBe(45);
  });

  it('blocks past half, not at it', () => {
    expect(isReEntryBlocked(14, 30)).toBe(false);
    expect(isReEntryBlocked(15, 30)).toBe(false);
    expect(isReEntryBlocked(16, 30)).toBe(true);
    expect(isReEntryBlocked(30, 60)).toBe(false);
    expect(isReEntryBlocked(31, 60)).toBe(true);
  });

  /** An allowance an import set to something that is not a clean multiple of 30. */
  it('rounds an odd allowance rather than leaving half a minute unreachable', () => {
    expect(reEntryThreshold(45)).toBe(23);
    expect(isReEntryBlocked(23, 45)).toBe(false);
    expect(isReEntryBlocked(24, 45)).toBe(true);
  });

  /** Nobody is locked out of the building by an allowance that was never set. */
  it('never blocks a student with no allowance to be half of', () => {
    expect(isReEntryBlocked(600, 0)).toBe(false);
  });
});

describe('minutes used today', () => {
  let db: TestDb;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    ({ db, cleanup } = await createTestDb());
  });
  afterAll(() => cleanup());

  it('sums every closed session on the day and ignores the open one', async () => {
    const centre = await makeCentre(db, { timezone: TZ });
    const student = await makeStudent(db, centre.id, { expectedMinutes: 30 });

    // 10 minutes, then 8 minutes, then back in and still here.
    await addEvent(db, { centreId: centre.id, studentId: student.id, type: 'check_in', occurredAt: at(15, 0) });
    await addEvent(db, { centreId: centre.id, studentId: student.id, type: 'check_out', occurredAt: at(15, 10) });
    await addEvent(db, { centreId: centre.id, studentId: student.id, type: 'check_in', occurredAt: at(15, 30) });
    await addEvent(db, { centreId: centre.id, studentId: student.id, type: 'check_out', occurredAt: at(15, 38) });
    await addEvent(db, { centreId: centre.id, studentId: student.id, type: 'check_in', occurredAt: at(16, 0) });

    // 18, not 18-plus-however-long-they-have-been-back: the open session is still being spent.
    expect(await minutesUsedToday(student.id, TZ, at(16, 20), asDb(db))).toBe(18);
  });

  it('does not count yesterday', async () => {
    const centre = await makeCentre(db, { timezone: TZ });
    const student = await makeStudent(db, centre.id, { expectedMinutes: 30 });
    await addEvent(db, {
      centreId: centre.id, studentId: student.id, type: 'check_in',
      occurredAt: at(15, 0, '2026-05-11'),
    });
    await addEvent(db, {
      centreId: centre.id, studentId: student.id, type: 'check_out',
      occurredAt: at(15, 28, '2026-05-11'),
    });

    expect(await minutesUsedToday(student.id, TZ, at(16, 0), asDb(db))).toBe(0);
    // Yesterday's own total is still there when you ask about yesterday.
    expect(await minutesUsedToday(student.id, TZ, at(16, 0, '2026-05-11'), asDb(db))).toBe(28);
  });

  it('reports the whole centre in one query, absent students simply missing', async () => {
    const centre = await makeCentre(db, { timezone: TZ });
    const seen = await makeStudent(db, centre.id, { firstName: 'Seen', expectedMinutes: 30 });
    const absent = await makeStudent(db, centre.id, { firstName: 'Absent', expectedMinutes: 30 });

    await addEvent(db, { centreId: centre.id, studentId: seen.id, type: 'check_in', occurredAt: at(15, 0) });
    await addEvent(db, { centreId: centre.id, studentId: seen.id, type: 'check_out', occurredAt: at(15, 20) });

    const used = await minutesUsedTodayByStudent(centre.id, TZ, at(16, 0), asDb(db));
    expect(used.get(seen.id)).toBe(20);
    expect(used.has(absent.id)).toBe(false);
  });
});

describe('the kiosk refusing a second check-in', () => {
  let db: TestDb;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    ({ db, cleanup } = await createTestDb());
  });
  afterAll(() => cleanup());

  async function eventsFor(studentId: string) {
    return db.select().from(attendanceEvent).where(eq(attendanceEvent.studentId, studentId));
  }

  /** A student who came in at 3:00pm and left again after `minutes`. */
  async function cameAndWent(minutes: number, expectedMinutes = 30) {
    const centre = await makeCentre(db, { timezone: TZ, name: 'Liberty' });
    const student = await makeStudent(db, centre.id, {
      firstName: 'Ava',
      lastInitial: 'R',
      expectedMinutes,
    });
    await addEvent(db, { centreId: centre.id, studentId: student.id, type: 'check_in', occurredAt: at(15, 0) });
    await addEvent(db, {
      centreId: centre.id, studentId: student.id, type: 'check_out',
      occurredAt: at(15, 0 + minutes),
    });
    return { centre, student };
  }

  it('refuses, and records nothing, once more than half the allowance is spent', async () => {
    const { centre, student } = await cameAndWent(20);

    const outcome = await resolveTapAndToggle(
      { centre, studentId: student.id, at: at(16, 0) },
      asDb(db),
    );

    expect(outcome).toEqual({
      ok: false,
      timeUsed: true,
      firstName: 'Ava',
      lastInitial: 'R',
    });

    // The refusal is not an event: the log still shows one completed session.
    const events = await eventsFor(student.id);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.type)).toEqual(['check_in', 'check_out']);
  });

  it('lets a student back in at exactly half', async () => {
    const { centre, student } = await cameAndWent(15);

    const outcome = await resolveTapAndToggle(
      { centre, studentId: student.id, at: at(16, 0) },
      asDb(db),
    );

    expect(outcome).toMatchObject({ ok: true, action: 'check_in' });
    expect(await eventsFor(student.id)).toHaveLength(3);
  });

  /** The thing the "total, not longest" answer buys: repeated short visits add up. */
  it('adds separate short visits together', async () => {
    const { centre, student } = await cameAndWent(10);

    // Second visit of 8 minutes — neither alone is past half, together they are 18.
    await addEvent(db, { centreId: centre.id, studentId: student.id, type: 'check_in', occurredAt: at(15, 30) });
    await addEvent(db, { centreId: centre.id, studentId: student.id, type: 'check_out', occurredAt: at(15, 38) });

    const outcome = await resolveTapAndToggle(
      { centre, studentId: student.id, at: at(16, 0) },
      asDb(db),
    );
    expect(outcome).toMatchObject({ ok: false, timeUsed: true });
  });

  /**
   * The rule is about coming back, never about leaving. A student inside the building must
   * always be able to check out, however much of the day they have spent — the fire-drill
   * case, and the reason this is checked separately from the pure function.
   */
  it('never blocks a check-out, however much time is used', async () => {
    const { centre, student } = await cameAndWent(25);

    // Back in (by the desk, say), then leaving again well past their allowance.
    await addEvent(db, { centreId: centre.id, studentId: student.id, type: 'check_in', occurredAt: at(16, 0) });

    const outcome = await resolveTapAndToggle(
      { centre, studentId: student.id, at: at(16, 40) },
      asDb(db),
    );
    expect(outcome).toMatchObject({ ok: true, action: 'check_out' });
  });

  it('lets a first arrival in no matter what yesterday looked like', async () => {
    const centre = await makeCentre(db, { timezone: TZ });
    const student = await makeStudent(db, centre.id, { expectedMinutes: 30 });
    await addEvent(db, {
      centreId: centre.id, studentId: student.id, type: 'check_in',
      occurredAt: at(15, 0, '2026-05-11'),
    });
    await addEvent(db, {
      centreId: centre.id, studentId: student.id, type: 'check_out',
      occurredAt: at(15, 29, '2026-05-11'),
    });

    const outcome = await resolveTapAndToggle(
      { centre, studentId: student.id, at: at(15, 0) },
      asDb(db),
    );
    expect(outcome).toMatchObject({ ok: true, action: 'check_in' });
  });

  /**
   * A child who taps twice on the way out gets the replayed "Checked out" result, not a
   * refusal — the same carve-out the early-departure rule makes for the grace window.
   */
  it('replays the previous result inside the double-scan window rather than refusing', async () => {
    // Two subjects, so 40 minutes is a legitimate check-out (early-departure allows it
    // from 50... so make it 55) while still being past half of 60. The two rules bound
    // this window from opposite sides, and only a two-subject student leaves room in it.
    const centre = await makeCentre(db, { timezone: TZ });
    const student = await makeStudent(db, centre.id, {
      subjects: ['Math', 'Reading'],
      expectedMinutes: 60,
    });
    await addEvent(db, { centreId: centre.id, studentId: student.id, type: 'check_in', occurredAt: at(15, 0) });

    // Out at 55 minutes: past early-departure's 50, and past half of 60.
    const out = await resolveTapAndToggle(
      { centre, studentId: student.id, at: at(15, 55) },
      asDb(db),
    );
    expect(out).toMatchObject({ ok: true, action: 'check_out' });

    // Tapping again five seconds later must not read as a blocked re-entry.
    const again = await resolveTapAndToggle(
      { centre, studentId: student.id, at: new Date(at(15, 55).getTime() + 5_000) },
      asDb(db),
    );
    expect(again).toMatchObject({ ok: true, action: 'check_out', repeated: true });
  });
});
