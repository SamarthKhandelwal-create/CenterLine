import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { addEvent, asDb, createTestDb, makeCentre, makeStudent, type TestDb } from './helpers/db';
import { setStudentSchedule, centreClassDays, dayLoad } from '@/lib/schedule/commands';
import {
  expectedToday,
  scheduleForStudent,
  schedulesNeedingReview,
  weekSchedule,
} from '@/lib/schedule/queries';

/** A Monday 5pm in New York, well away from any boundary. */
const MONDAY = new Date('2026-10-12T21:00:00Z');

describe('student schedules', () => {
  let db: TestDb;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    ({ db, cleanup } = await createTestDb());
  });
  afterAll(() => cleanup());

  it('stores a week and reads it back', async () => {
    const centre = await makeCentre(db);
    const student = await makeStudent(db, centre.id, { firstName: 'Ava', lastInitial: 'A' });

    await setStudentSchedule(
      {
        centreId: centre.id,
        studentId: student.id,
        slots: [
          { weekday: 1, startsAt: '17:00:00' },
          { weekday: 4, startsAt: null, note: 'Flex/Monthly' },
        ],
      },
      asDb(db),
    );

    const week = await scheduleForStudent(student.id, asDb(db));
    expect(week).toHaveLength(2);
    expect(week[0]).toMatchObject({ weekday: 1, startsAt: '17:00:00' });
    expect(week[1]).toMatchObject({ weekday: 4, startsAt: null, note: 'Flex/Monthly' });
  });

  it('replaces the week rather than adding to it', async () => {
    const centre = await makeCentre(db);
    const student = await makeStudent(db, centre.id);

    await setStudentSchedule(
      { centreId: centre.id, studentId: student.id, slots: [{ weekday: 1 }, { weekday: 4 }] },
      asDb(db),
    );
    // Moved from Monday+Thursday to Tuesday alone.
    await setStudentSchedule(
      { centreId: centre.id, studentId: student.id, slots: [{ weekday: 2, startsAt: '16:00:00' }] },
      asDb(db),
    );

    const week = await scheduleForStudent(student.id, asDb(db));
    expect(week).toHaveLength(1);
    expect(week[0]!.weekday).toBe(2);
  });

  it('clears a week when given no days', async () => {
    const centre = await makeCentre(db);
    const student = await makeStudent(db, centre.id);
    await setStudentSchedule(
      { centreId: centre.id, studentId: student.id, slots: [{ weekday: 1 }] },
      asDb(db),
    );
    await setStudentSchedule({ centreId: centre.id, studentId: student.id, slots: [] }, asDb(db));
    expect(await scheduleForStudent(student.id, asDb(db))).toEqual([]);
  });

  it('refuses a day that is not a day', async () => {
    const centre = await makeCentre(db);
    const student = await makeStudent(db, centre.id);
    await expect(
      setStudentSchedule(
        { centreId: centre.id, studentId: student.id, slots: [{ weekday: 7 }] },
        asDb(db),
      ),
    ).rejects.toThrow(/not a weekday/);
  });

  it('refuses two entries for one day', async () => {
    const centre = await makeCentre(db);
    const student = await makeStudent(db, centre.id);
    await expect(
      setStudentSchedule(
        {
          centreId: centre.id,
          studentId: student.id,
          slots: [{ weekday: 1, startsAt: '16:00:00' }, { weekday: 1, startsAt: '17:00:00' }],
        },
        asDb(db),
      ),
    ).rejects.toThrow(/one schedule entry per day/);
  });

  /** The constraint has to live in the database, not only in the caller. */
  it('the database itself rejects a second row for the same day', async () => {
    const centre = await makeCentre(db);
    const student = await makeStudent(db, centre.id);
    await db.execute(sql`
      INSERT INTO student_schedule (centre_id, student_id, weekday)
      VALUES (${centre.id}, ${student.id}, 1)`);
    await expect(
      db.execute(sql`
        INSERT INTO student_schedule (centre_id, student_id, weekday)
        VALUES (${centre.id}, ${student.id}, 1)`),
    ).rejects.toThrow();
  });

  it('the database itself rejects an impossible weekday', async () => {
    const centre = await makeCentre(db);
    const student = await makeStudent(db, centre.id);
    await expect(
      db.execute(sql`
        INSERT INTO student_schedule (centre_id, student_id, weekday)
        VALUES (${centre.id}, ${student.id}, 9)`),
    ).rejects.toThrow();
  });

  /**
   * Centre isolation is asserted elsewhere for attendance; a schedule must not be the
   * hole in it. Passing another centre's student id must fail, not silently attach a
   * row to a child at a centre the caller cannot see.
   */
  it('will not schedule a student from another centre', async () => {
    const mine = await makeCentre(db, { name: 'Mine' });
    const theirs = await makeCentre(db, { name: 'Theirs' });
    const theirStudent = await makeStudent(db, theirs.id);

    await expect(
      setStudentSchedule(
        { centreId: mine.id, studentId: theirStudent.id, slots: [{ weekday: 1 }] },
        asDb(db),
      ),
    ).rejects.toThrow(/not at this centre/);

    expect(await scheduleForStudent(theirStudent.id, asDb(db))).toEqual([]);
  });

  it('deletes the schedule when the student goes', async () => {
    const centre = await makeCentre(db);
    const student = await makeStudent(db, centre.id);
    await setStudentSchedule(
      { centreId: centre.id, studentId: student.id, slots: [{ weekday: 1 }] },
      asDb(db),
    );
    await db.execute(sql`DELETE FROM student WHERE id = ${student.id}`);
    const left = await db.execute(sql`
      SELECT count(*)::int n FROM student_schedule WHERE student_id = ${student.id}`);
    expect((left.rows[0] as { n: number }).n).toBe(0);
  });
});

describe('who is expected today', () => {
  let db: TestDb;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    ({ db, cleanup } = await createTestDb());
  });
  afterAll(() => cleanup());

  it('returns only the students scheduled for that weekday', async () => {
    const centre = await makeCentre(db);
    const monday = await makeStudent(db, centre.id, { firstName: 'Mona', lastInitial: 'M' });
    const thursday = await makeStudent(db, centre.id, { firstName: 'Thea', lastInitial: 'T' });

    await setStudentSchedule(
      { centreId: centre.id, studentId: monday.id, slots: [{ weekday: 1, startsAt: '17:00:00' }] },
      asDb(db),
    );
    await setStudentSchedule(
      { centreId: centre.id, studentId: thursday.id, slots: [{ weekday: 4 }] },
      asDb(db),
    );

    const expected = await expectedToday(centre.id, centre.timezone, MONDAY, asDb(db));
    expect(expected.map((e) => e.firstName)).toEqual(['Mona']);
  });

  it('leaves out students who are no longer active', async () => {
    const centre = await makeCentre(db);
    const gone = await makeStudent(db, centre.id, { firstName: 'Gone', status: 'inactive' });
    await setStudentSchedule(
      { centreId: centre.id, studentId: gone.id, slots: [{ weekday: 1 }] },
      asDb(db),
    );
    const expected = await expectedToday(centre.id, centre.timezone, MONDAY, asDb(db));
    expect(expected.map((e) => e.firstName)).not.toContain('Gone');
  });

  it('says who has arrived and who has not', async () => {
    const centre = await makeCentre(db);
    const here = await makeStudent(db, centre.id, { firstName: 'Here', lastInitial: 'H' });
    const missing = await makeStudent(db, centre.id, { firstName: 'Missing', lastInitial: 'M' });
    for (const s of [here, missing]) {
      await setStudentSchedule(
        { centreId: centre.id, studentId: s.id, slots: [{ weekday: 1, startsAt: '16:00:00' }] },
        asDb(db),
      );
    }
    await addEvent(db, {
      centreId: centre.id,
      studentId: here.id,
      type: 'check_in',
      occurredAt: new Date('2026-10-12T20:05:00Z'),
    });

    const expected = await expectedToday(centre.id, centre.timezone, MONDAY, asDb(db));
    const byName = Object.fromEntries(expected.map((e) => [e.firstName, e.arrived]));
    expect(byName).toEqual({ Here: true, Missing: false });
  });

  /**
   * The timezone bug worth guarding: a Saturday 8pm session in New York is already
   * Sunday in UTC, so reading the weekday from the server empties the roster.
   */
  it('uses the centre weekday, so a Saturday evening is still Saturday', async () => {
    const centre = await makeCentre(db, { timezone: 'America/New_York' });
    const saturday = await makeStudent(db, centre.id, { firstName: 'Sat', lastInitial: 'S' });
    await setStudentSchedule(
      { centreId: centre.id, studentId: saturday.id, slots: [{ weekday: 6 }] },
      asDb(db),
    );

    // 2026-10-11T01:30Z is Saturday 21:30 in New York but Sunday in UTC.
    const lateSaturday = new Date('2026-10-11T01:30:00Z');
    const expected = await expectedToday(centre.id, centre.timezone, lateSaturday, asDb(db));
    expect(expected.map((e) => e.firstName)).toEqual(['Sat']);
  });

  it('never shows another centre a student', async () => {
    const mine = await makeCentre(db, { name: 'Mine 2' });
    const theirs = await makeCentre(db, { name: 'Theirs 2' });
    const theirStudent = await makeStudent(db, theirs.id, { firstName: 'Nope' });
    await setStudentSchedule(
      { centreId: theirs.id, studentId: theirStudent.id, slots: [{ weekday: 1 }] },
      asDb(db),
    );

    const expected = await expectedToday(mine.id, mine.timezone, MONDAY, asDb(db));
    expect(expected).toEqual([]);
  });

  it('orders by arrival time, with no-time students last', async () => {
    const centre = await makeCentre(db, { name: 'Ordered' });
    const late = await makeStudent(db, centre.id, { firstName: 'Late', lastInitial: 'L' });
    const early = await makeStudent(db, centre.id, { firstName: 'Early', lastInitial: 'E' });
    const whenever = await makeStudent(db, centre.id, { firstName: 'Whenever', lastInitial: 'W' });

    await setStudentSchedule(
      { centreId: centre.id, studentId: late.id, slots: [{ weekday: 1, startsAt: '18:00:00' }] },
      asDb(db),
    );
    await setStudentSchedule(
      { centreId: centre.id, studentId: early.id, slots: [{ weekday: 1, startsAt: '16:00:00' }] },
      asDb(db),
    );
    await setStudentSchedule(
      { centreId: centre.id, studentId: whenever.id, slots: [{ weekday: 1, startsAt: null }] },
      asDb(db),
    );

    const expected = await expectedToday(centre.id, centre.timezone, MONDAY, asDb(db));
    expect(expected.map((e) => e.firstName)).toEqual(['Early', 'Late', 'Whenever']);
  });
});

describe('the week, and the gaps in it', () => {
  let db: TestDb;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    ({ db, cleanup } = await createTestDb());
  });
  afterAll(() => cleanup());

  it('groups the roster by day and lists who has no schedule', async () => {
    const centre = await makeCentre(db);
    const scheduled = await makeStudent(db, centre.id, { firstName: 'Sched', lastInitial: 'S' });
    const unscheduled = await makeStudent(db, centre.id, { firstName: 'Unsched', lastInitial: 'U' });

    await setStudentSchedule(
      {
        centreId: centre.id,
        studentId: scheduled.id,
        slots: [{ weekday: 2, startsAt: '16:00:00' }, { weekday: 5, startsAt: '17:00:00' }],
      },
      asDb(db),
    );

    const week = await weekSchedule(centre.id, asDb(db));
    expect(week.byWeekday[2]!.map((s) => s.firstName)).toEqual(['Sched']);
    expect(week.byWeekday[5]!.map((s) => s.firstName)).toEqual(['Sched']);
    expect(week.byWeekday[1]).toEqual([]);
    expect(week.unscheduled.map((s) => s.studentId)).toEqual([unscheduled.id]);
  });

  it('flags days that have no arrival time, for review', async () => {
    const centre = await makeCentre(db, { name: 'Review' });
    const flex = await makeStudent(db, centre.id, { firstName: 'Flex', lastInitial: 'F' });
    const fixed = await makeStudent(db, centre.id, { firstName: 'Fixed', lastInitial: 'F' });

    await setStudentSchedule(
      {
        centreId: centre.id,
        studentId: flex.id,
        slots: [{ weekday: 3, startsAt: null, note: 'Flex/Monthly' }],
      },
      asDb(db),
    );
    await setStudentSchedule(
      { centreId: centre.id, studentId: fixed.id, slots: [{ weekday: 3, startsAt: '16:00:00' }] },
      asDb(db),
    );

    const review = await schedulesNeedingReview(centre.id, asDb(db));
    expect(review).toHaveLength(1);
    expect(review[0]).toMatchObject({ firstName: 'Flex', weekday: 3, note: 'Flex/Monthly' });
  });

  it('works out which days the centre actually teaches', async () => {
    const centre = await makeCentre(db, { name: 'Days' });
    // Three on Tuesday, one on Friday, none anywhere else.
    for (let i = 0; i < 3; i += 1) {
      const s = await makeStudent(db, centre.id, { firstName: `T${i}` });
      await setStudentSchedule(
        { centreId: centre.id, studentId: s.id, slots: [{ weekday: 2 }] },
        asDb(db),
      );
    }
    const fri = await makeStudent(db, centre.id, { firstName: 'Fri' });
    await setStudentSchedule(
      { centreId: centre.id, studentId: fri.id, slots: [{ weekday: 5 }] },
      asDb(db),
    );

    const days = await centreClassDays(centre.id, asDb(db));
    expect(days).toEqual([
      { weekday: 2, students: 3 },
      { weekday: 5, students: 1 },
    ]);
  });

  it('counts how full each time slot is', async () => {
    const centre = await makeCentre(db, { name: 'Load' });
    for (let i = 0; i < 2; i += 1) {
      const s = await makeStudent(db, centre.id, { firstName: `A${i}` });
      await setStudentSchedule(
        { centreId: centre.id, studentId: s.id, slots: [{ weekday: 1, startsAt: '16:00:00' }] },
        asDb(db),
      );
    }
    const other = await makeStudent(db, centre.id, { firstName: 'B' });
    await setStudentSchedule(
      { centreId: centre.id, studentId: other.id, slots: [{ weekday: 1, startsAt: '17:00:00' }] },
      asDb(db),
    );

    const load = await dayLoad(centre.id, 1, asDb(db));
    expect(load).toEqual([
      { startsAt: '16:00:00', students: 2 },
      { startsAt: '17:00:00', students: 1 },
    ]);
  });
});
