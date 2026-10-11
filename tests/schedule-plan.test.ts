import { describe, expect, it } from 'vitest';
import {
  formatScheduleTime,
  isWeekday,
  localWeekday,
  parseScheduleTime,
  parseWeekday,
  weekdayName,
  weekdayShortName,
} from '@/lib/schedule/weekday';
import { planSchedule, type PlanStudent } from '@/lib/schedule/plan';

describe('weekday helpers', () => {
  it('parses the day names these rosters use', () => {
    expect(parseWeekday('Mon')).toBe(1);
    expect(parseWeekday('Thu')).toBe(4);
    expect(parseWeekday('Sat')).toBe(6);
    expect(parseWeekday('Tue')).toBe(2);
    expect(parseWeekday('Wed')).toBe(3);
    expect(parseWeekday('Fri')).toBe(5);
    // Trailing spaces and punctuation are everywhere in these headers.
    expect(parseWeekday('  Monday ')).toBe(1);
    expect(parseWeekday('TUES.')).toBe(2);
    expect(parseWeekday('Sunday')).toBe(0);
  });

  it('refuses things that are not days', () => {
    expect(parseWeekday('Math')).toBeNull();
    expect(parseWeekday('4:00-4:30')).toBeNull();
    expect(parseWeekday('')).toBeNull();
    expect(parseWeekday("Mother's Name")).toBeNull();
  });

  it('bounds a weekday to the seven real ones', () => {
    expect(isWeekday(0)).toBe(true);
    expect(isWeekday(6)).toBe(true);
    expect(isWeekday(7)).toBe(false);
    expect(isWeekday(-1)).toBe(false);
    expect(isWeekday(1.5)).toBe(false);
  });

  it('names days for display', () => {
    expect(weekdayName(1)).toBe('Monday');
    expect(weekdayShortName(4)).toBe('Thu');
    expect(weekdayName(99)).toBe('Unknown');
  });

  /**
   * The bug this prevents: on Vercel the server clock is UTC, so a Saturday evening
   * in New York is already Sunday. Reading the weekday from the server would empty a
   * Saturday roster at 8pm, every Saturday.
   */
  it('reads the weekday in the centre timezone, not the server', () => {
    // 2026-10-11 01:30 UTC is still Saturday 2026-10-10 in New York.
    const at = new Date('2026-10-11T01:30:00Z');
    expect(localWeekday(at, 'America/New_York')).toBe(6); // Saturday
    expect(localWeekday(at, 'UTC')).toBe(0); // Sunday
  });

  it('stays correct across a DST change', () => {
    // US DST ends 2026-11-01. 05:30 UTC is 01:30 EDT on Sunday the 1st.
    const during = new Date('2026-11-01T05:30:00Z');
    expect(localWeekday(during, 'America/New_York')).toBe(0);
    // 03:30 UTC on 2026-03-08 is 22:30 EST on Saturday the 7th, the night DST starts.
    const before = new Date('2026-03-08T03:30:00Z');
    expect(localWeekday(before, 'America/New_York')).toBe(6);
  });

  it('parses the arrival times the rosters carry', () => {
    expect(parseScheduleTime('5:00 PM')).toBe('17:00:00');
    expect(parseScheduleTime('11:00 AM')).toBe('11:00:00');
    expect(parseScheduleTime('4:30 PM')).toBe('16:30:00');
    expect(parseScheduleTime('12:00 PM')).toBe('12:00:00'); // noon, not midnight
    expect(parseScheduleTime('12:30 AM')).toBe('00:30:00'); // midnight, not noon
    expect(parseScheduleTime('17:30')).toBe('17:30:00'); // 24-hour
  });

  it('treats text that is not a time as not a time', () => {
    // "Flex/Monthly" appears in the time column of the real Mason roster.
    expect(parseScheduleTime('Flex/Monthly')).toBeNull();
    expect(parseScheduleTime('')).toBeNull();
    expect(parseScheduleTime('1')).toBeNull();
    expect(parseScheduleTime('25:00')).toBeNull();
    expect(parseScheduleTime('5:70 PM')).toBeNull();
    expect(parseScheduleTime('13:00 PM')).toBeNull();
  });

  it('formats a stored time back for display', () => {
    expect(formatScheduleTime('17:00:00')).toBe('5:00 PM');
    expect(formatScheduleTime('09:05:00')).toBe('9:05 AM');
    expect(formatScheduleTime('12:00:00')).toBe('12:00 PM');
    expect(formatScheduleTime('00:30:00')).toBe('12:30 AM');
    expect(formatScheduleTime(null)).toBeNull();
  });
});

const MASON_DAYS = [2, 3, 5]; // Tue, Wed, Fri
const TIMES = ['16:00:00', '16:30:00', '17:00:00'];

function students(n: number, subjects: string[] = ['Math']): PlanStudent[] {
  return Array.from({ length: n }, (_, i) => ({
    studentId: `s${String(i).padStart(3, '0')}`,
    firstName: `Student${String(i).padStart(3, '0')}`,
    lastInitial: 'X',
    subjects,
  }));
}

describe('building a schedule', () => {
  it('gives one session per subject', () => {
    const plan = planSchedule(
      [
        { studentId: 'a', firstName: 'Ava', lastInitial: 'A', subjects: ['Math'] },
        { studentId: 'b', firstName: 'Ben', lastInitial: 'B', subjects: ['Math', 'Reading'] },
      ],
      { classDays: MASON_DAYS, times: TIMES, capacity: 10 },
    );
    expect(plan.assignments.find((a) => a.studentId === 'a')!.slots).toHaveLength(1);
    expect(plan.assignments.find((a) => a.studentId === 'b')!.slots).toHaveLength(2);
    expect(plan.unplaced).toEqual([]);
  });

  it('never puts a student on the same day twice', () => {
    const plan = planSchedule(
      [{ studentId: 'a', firstName: 'Ava', lastInitial: 'A', subjects: ['Math', 'Reading'] }],
      { classDays: MASON_DAYS, times: TIMES, capacity: 10 },
    );
    const days = plan.assignments[0]!.slots.map((s) => s.weekday);
    expect(new Set(days).size).toBe(days.length);
  });

  it('caps sessions at the number of class days', () => {
    // Four subjects, but the centre teaches three days a week.
    const plan = planSchedule(
      [{ studentId: 'a', firstName: 'Ava', lastInitial: 'A', subjects: ['Math', 'Reading', 'Japanese', 'Extra'] }],
      { classDays: MASON_DAYS, times: TIMES, capacity: 10 },
    );
    expect(plan.assignments[0]!.slots).toHaveLength(3);
  });

  it('spreads students evenly instead of packing one slot', () => {
    const plan = planSchedule(students(9), {
      classDays: MASON_DAYS,
      times: TIMES,
      capacity: 10,
    });
    // Nine students, nine slots, one each.
    for (const slot of plan.load) expect(slot.students).toBe(1);
  });

  it('respects capacity and reports who could not be placed', () => {
    // 3 days x 1 time x capacity 2 = 6 places; 8 students want one each.
    const plan = planSchedule(students(8), {
      classDays: MASON_DAYS,
      times: ['16:00:00'],
      capacity: 2,
    });
    expect(plan.assignments).toHaveLength(6);
    expect(plan.unplaced).toHaveLength(2);
    expect(plan.unplaced[0]!.reason).toMatch(/full/i);
    for (const slot of plan.load) expect(slot.students).toBeLessThanOrEqual(2);
  });

  it('counts students already scheduled against capacity', () => {
    const plan = planSchedule(students(2), {
      classDays: [2],
      times: ['16:00:00'],
      capacity: 3,
      existingLoad: [{ weekday: 2, startsAt: '16:00:00', students: 2 }],
    });
    // One place left, so one student is placed and one is not.
    expect(plan.assignments).toHaveLength(1);
    expect(plan.unplaced).toHaveLength(1);
    expect(plan.load[0]!.students).toBe(3);
  });

  it('ignores existing rows that have no fixed time', () => {
    // A day-without-a-time occupies no place in the grid.
    const plan = planSchedule(students(1), {
      classDays: [2],
      times: ['16:00:00'],
      capacity: 1,
      existingLoad: [{ weekday: 2, startsAt: null, students: 5 }],
    });
    expect(plan.assignments).toHaveLength(1);
  });

  it('flags a partial placement rather than passing it as complete', () => {
    // Two sessions wanted, but only one day has room.
    const plan = planSchedule(
      [{ studentId: 'a', firstName: 'Ava', lastInitial: 'A', subjects: ['Math', 'Reading'] }],
      {
        classDays: [2, 3],
        times: ['16:00:00'],
        capacity: 1,
        existingLoad: [{ weekday: 3, startsAt: '16:00:00', students: 1 }],
      },
    );
    expect(plan.assignments[0]!.slots).toHaveLength(1);
    expect(plan.unplaced[0]!.reason).toMatch(/Only 1 of 2/);
  });

  it('is deterministic: the same input gives the same plan', () => {
    const roster = students(12, ['Math', 'Reading']);
    const options = { classDays: MASON_DAYS, times: TIMES, capacity: 5 };
    const a = planSchedule(roster, options);
    // Shuffled input, same plan — order of the roster must not change the outcome.
    const b = planSchedule([...roster].reverse(), options);
    expect(b.assignments).toEqual(a.assignments);
  });

  it('places everyone somewhere when there is room for everyone', () => {
    const roster = students(30, ['Math', 'Reading']);
    const plan = planSchedule(roster, { classDays: MASON_DAYS, times: TIMES, capacity: 25 });
    expect(plan.assignments).toHaveLength(30);
    expect(plan.unplaced).toEqual([]);
    const total = plan.load.reduce((n, s) => n + s.students, 0);
    expect(total).toBe(60); // 30 students x 2 sessions
  });

  it('refuses to invent a schedule with no days or no times', () => {
    const noDays = planSchedule(students(3), { classDays: [], times: TIMES, capacity: 5 });
    expect(noDays.assignments).toEqual([]);
    expect(noDays.unplaced).toHaveLength(3);

    const noTimes = planSchedule(students(3), { classDays: MASON_DAYS, times: [], capacity: 5 });
    expect(noTimes.unplaced).toHaveLength(3);

    const noRoom = planSchedule(students(3), { classDays: MASON_DAYS, times: TIMES, capacity: 0 });
    expect(noRoom.unplaced[0]!.reason).toMatch(/at least 1/);
  });

  it('handles an empty roster without complaint', () => {
    const plan = planSchedule([], { classDays: MASON_DAYS, times: TIMES, capacity: 5 });
    expect(plan.assignments).toEqual([]);
    expect(plan.unplaced).toEqual([]);
    expect(plan.load.every((s) => s.students === 0)).toBe(true);
  });

  it('only ever produces real weekdays and offered times', () => {
    const plan = planSchedule(students(20, ['Math', 'Reading']), {
      classDays: MASON_DAYS,
      times: TIMES,
      capacity: 10,
    });
    for (const a of plan.assignments) {
      for (const slot of a.slots) {
        expect(MASON_DAYS).toContain(slot.weekday);
        expect(TIMES).toContain(slot.startsAt);
      }
    }
  });
});
