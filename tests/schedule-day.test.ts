import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addEvent, asDb, createTestDb, makeCentre, makeStudent, type TestDb } from './helpers/db';
import { setStudentSchedule } from '@/lib/schedule/commands';
import { expectedToday } from '@/lib/schedule/queries';
import { absentStudents } from '@/lib/attendance/queries';

/** Monday 2026-10-12, 5pm in New York. */
const MONDAY = new Date('2026-10-12T21:00:00Z');

/**
 * The behaviour the Day screen depends on.
 *
 * Before schedules existed, "Expected but not seen today" listed every active student
 * who had not come in — on a Monday that included the Tuesday and Thursday children,
 * so the list was long enough to be ignored. These assert that the narrowing is real
 * and that the old answer is still available for a centre with no schedules yet.
 */
describe('the day screen, narrowed by schedule', () => {
  let db: TestDb;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    ({ db, cleanup } = await createTestDb());
  });
  afterAll(() => cleanup());

  it('counts only the students scheduled for today as missing', async () => {
    const centre = await makeCentre(db);
    const monday = await makeStudent(db, centre.id, { firstName: 'Mona', lastInitial: 'M' });
    const tuesday = await makeStudent(db, centre.id, { firstName: 'Tess', lastInitial: 'T' });
    const noSchedule = await makeStudent(db, centre.id, { firstName: 'Nobody', lastInitial: 'N' });

    await setStudentSchedule(
      { centreId: centre.id, studentId: monday.id, slots: [{ weekday: 1, startsAt: '17:00:00' }] },
      asDb(db),
    );
    await setStudentSchedule(
      { centreId: centre.id, studentId: tuesday.id, slots: [{ weekday: 2, startsAt: '17:00:00' }] },
      asDb(db),
    );

    // The old query still sees all three as not-seen.
    const absent = await absentStudents(centre.id, centre.timezone, MONDAY, asDb(db));
    expect(absent).toHaveLength(3);

    // The new one narrows to the child actually expected on a Monday.
    const expected = await expectedToday(centre.id, centre.timezone, MONDAY, asDb(db));
    const missing = expected.filter((s) => !s.arrived);
    expect(missing.map((m) => m.firstName)).toEqual(['Mona']);
    expect(noSchedule).toBeDefined();
  });

  it('drops a student from missing once they arrive', async () => {
    const centre = await makeCentre(db, { name: 'Arrivals' });
    const student = await makeStudent(db, centre.id, { firstName: 'Ava', lastInitial: 'A' });
    await setStudentSchedule(
      { centreId: centre.id, studentId: student.id, slots: [{ weekday: 1, startsAt: '17:00:00' }] },
      asDb(db),
    );

    let expected = await expectedToday(centre.id, centre.timezone, MONDAY, asDb(db));
    expect(expected.filter((s) => !s.arrived)).toHaveLength(1);

    await addEvent(db, {
      centreId: centre.id,
      studentId: student.id,
      type: 'check_in',
      occurredAt: new Date('2026-10-12T20:55:00Z'),
    });

    expected = await expectedToday(centre.id, centre.timezone, MONDAY, asDb(db));
    expect(expected.filter((s) => !s.arrived)).toHaveLength(0);
  });

  /**
   * A student who came and went is still accounted for: `arrived` asks whether they
   * were seen at all today, not whether they are here now.
   */
  it('keeps a student accounted for after they check out', async () => {
    const centre = await makeCentre(db, { name: 'Left early' });
    const student = await makeStudent(db, centre.id, { firstName: 'Gone', lastInitial: 'G' });
    await setStudentSchedule(
      { centreId: centre.id, studentId: student.id, slots: [{ weekday: 1, startsAt: '16:00:00' }] },
      asDb(db),
    );
    await addEvent(db, {
      centreId: centre.id,
      studentId: student.id,
      type: 'check_in',
      occurredAt: new Date('2026-10-12T20:00:00Z'),
    });
    await addEvent(db, {
      centreId: centre.id,
      studentId: student.id,
      type: 'check_out',
      occurredAt: new Date('2026-10-12T20:40:00Z'),
    });

    const expected = await expectedToday(centre.id, centre.timezone, MONDAY, asDb(db));
    expect(expected[0]!.arrived).toBe(true);
  });

  it('does not count yesterday attendance as arriving today', async () => {
    const centre = await makeCentre(db, { name: 'Yesterday' });
    const student = await makeStudent(db, centre.id, { firstName: 'Old', lastInitial: 'O' });
    await setStudentSchedule(
      { centreId: centre.id, studentId: student.id, slots: [{ weekday: 1, startsAt: '16:00:00' }] },
      asDb(db),
    );
    // A week earlier, also a Monday.
    await addEvent(db, {
      centreId: centre.id,
      studentId: student.id,
      type: 'check_in',
      occurredAt: new Date('2026-10-05T20:00:00Z'),
    });

    const expected = await expectedToday(centre.id, centre.timezone, MONDAY, asDb(db));
    expect(expected[0]!.arrived).toBe(false);
  });

  it('returns nothing for a centre that has set no schedules', async () => {
    const centre = await makeCentre(db, { name: 'Unscheduled centre' });
    await makeStudent(db, centre.id, { firstName: 'Someone' });
    // Empty here is what makes the Day screen fall back to the old list rather than
    // silently showing no one.
    expect(await expectedToday(centre.id, centre.timezone, MONDAY, asDb(db))).toEqual([]);
    expect(await absentStudents(centre.id, centre.timezone, MONDAY, asDb(db))).toHaveLength(1);
  });
});
