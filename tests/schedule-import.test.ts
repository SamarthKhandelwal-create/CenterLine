import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { asDb, createTestDb, makeCentre, type TestDb } from './helpers/db';
import { analyzeImport } from '@/lib/import/analyze';
import { commitImport } from '@/lib/import/commit';
import { matchColumns } from '@/lib/import/match-columns';
import { scheduleForStudent } from '@/lib/schedule/queries';

function csv(rows: string[][]): Buffer {
  return Buffer.from(
    rows
      .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','))
      .join('\n'),
    'utf8',
  );
}

/**
 * The Liberty roster's real column layout: the weekday headers appear TWICE, the
 * first block flagging attendance with "1" and the second giving the arrival time.
 */
const HEADER = [
  'S. No.', 'Student Last ', 'Student Name', 'Math', 'Read', 'Class',
  'Mon', 'Thu', 'Sat', 'Mon', 'Thu', 'Sat',
  'Student Name', "Father's Name", 'Cell',
];

const LIBERTY = csv([
  HEADER,
  // Two days, times on both.
  ['1', 'Khandelwal', 'Samarth Khandelwal', 'Y', 'Y', 'M',
    '1', '1', '', '5:00 PM', '6:00 PM', '', 'Samarth Khandelwal', 'Manish Khandelwal', '860-989-7952'],
  // A day flagged with no time against it — real, and common in these files.
  ['2', 'Moss', 'Jude Moss', 'Y', '', 'M',
    '1', '', '', '', '', '', 'Jude Moss', 'Peter Moss', '513-555-0112'],
  // "Flex/Monthly" sits in the TIME column with no flag beside it.
  ['3', 'Alsabbagh', 'Adam Alsabbagh', 'Y', '', 'M',
    '', '', '', '', 'Flex/Monthly', '', 'Adam Alsabbagh', 'Sam Alsabbagh', '513-884-0517'],
  // No schedule at all.
  ['4', 'Humphrey', 'Chole Humphrey', 'Y', '', 'M',
    '', '', '', '', '', '', 'Chole Humphrey', 'Rob Humphrey', '513-555-0201'],
]);

describe('reading the schedule out of a roster', () => {
  let db: TestDb;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    ({ db, cleanup } = await createTestDb());
  });
  afterAll(() => cleanup());

  it('pairs each repeated weekday header with its time column', () => {
    const mapping = matchColumns(HEADER);
    expect(mapping.dayColumns).toEqual([
      { weekday: 1, flagColumn: 6, timeColumn: 9 },
      { weekday: 4, flagColumn: 7, timeColumn: 10 },
      { weekday: 6, flagColumn: 8, timeColumn: 11 },
    ]);
  });

  it('does not mistake a day column for anything else', () => {
    const mapping = matchColumns(HEADER);
    const dayCols = new Set([6, 7, 8, 9, 10, 11]);
    for (const column of Object.values(mapping)) {
      if (typeof column === 'number') expect(dayCols.has(column)).toBe(false);
    }
  });

  it('leaves no day column in the unmapped list', async () => {
    const centre = await makeCentre(db);
    const plan = await analyzeImport(centre.id, LIBERTY, asDb(db));
    for (const header of ['Mon', 'Thu', 'Sat']) {
      expect(plan.unmappedHeaders).not.toContain(header);
    }
  });

  it('reads days and times into the candidate', async () => {
    const centre = await makeCentre(db);
    const plan = await analyzeImport(centre.id, LIBERTY, asDb(db));
    const [samarth, jude, adam, chole] = plan.items.map((i) => i.candidate);

    expect(samarth!.schedule).toEqual([
      { weekday: 1, startsAt: '17:00:00', note: null },
      { weekday: 4, startsAt: '18:00:00', note: null },
    ]);
    // A flagged day with no time is an expectation without a clock.
    expect(jude!.schedule).toEqual([{ weekday: 1, startsAt: null, note: null }]);
    // Text in the time column counts as a day and keeps what it said.
    expect(adam!.schedule).toEqual([{ weekday: 4, startsAt: null, note: 'Flex/Monthly' }]);
    expect(chole!.schedule).toEqual([]);
  });

  it('writes the schedule on import', async () => {
    const centre = await makeCentre(db, { name: 'Writes' });
    const plan = await analyzeImport(centre.id, LIBERTY, asDb(db));
    await commitImport({ centreId: centre.id, plan }, asDb(db));

    const rows = await db.execute(sql`
      SELECT s.first_name, sch.weekday, sch.starts_at::text AS starts_at, sch.note
      FROM student_schedule sch JOIN student s ON s.id = sch.student_id
      WHERE sch.centre_id = ${centre.id} ORDER BY s.first_name, sch.weekday`);
    expect(rows.rows).toEqual([
      { first_name: 'Adam', weekday: 4, starts_at: null, note: 'Flex/Monthly' },
      { first_name: 'Jude', weekday: 1, starts_at: null, note: null },
      { first_name: 'Samarth', weekday: 1, starts_at: '17:00:00', note: null },
      { first_name: 'Samarth', weekday: 4, starts_at: '18:00:00', note: null },
    ]);
  });

  it('re-imports the same file without changing anything', async () => {
    const centre = await makeCentre(db, { name: 'Idempotent' });
    await commitImport(
      { centreId: centre.id, plan: await analyzeImport(centre.id, LIBERTY, asDb(db)) },
      asDb(db),
    );

    const before = await db.execute(sql`
      SELECT md5(string_agg(student_id::text || weekday || coalesce(starts_at::text, ''), '~'
        ORDER BY student_id, weekday)) h
      FROM student_schedule WHERE centre_id = ${centre.id}`);

    const second = await analyzeImport(centre.id, LIBERTY, asDb(db));
    expect(second.counts).toMatchObject({ new: 0, updated: 0, unchanged: 4 });
    await commitImport({ centreId: centre.id, plan: second }, asDb(db));

    const after = await db.execute(sql`
      SELECT md5(string_agg(student_id::text || weekday || coalesce(starts_at::text, ''), '~'
        ORDER BY student_id, weekday)) h
      FROM student_schedule WHERE centre_id = ${centre.id}`);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('shows a changed week as a change to review', async () => {
    const centre = await makeCentre(db, { name: 'Changed' });
    await commitImport(
      { centreId: centre.id, plan: await analyzeImport(centre.id, LIBERTY, asDb(db)) },
      asDb(db),
    );

    // Samarth moves from Mon 5pm + Thu 6pm to Mon 4pm alone.
    const moved = csv([
      HEADER,
      ['1', 'Khandelwal', 'Samarth Khandelwal', 'Y', 'Y', 'M',
        '1', '', '', '4:00 PM', '', '', 'Samarth Khandelwal', 'Manish Khandelwal', '860-989-7952'],
    ]);
    const plan = await analyzeImport(centre.id, moved, asDb(db));
    const item = plan.items[0]!;
    expect(item.action).toBe('updated');
    const change = item.changes.find((c) => c.field === 'Schedule');
    expect(change).toBeDefined();
    expect(change!.from).toBe('Mon 5:00 PM, Thu 6:00 PM');
    expect(change!.to).toBe('Mon 4:00 PM');

    await commitImport({ centreId: centre.id, plan }, asDb(db));
    const rows = await db.execute(sql`
      SELECT sch.weekday, sch.starts_at::text AS starts_at
      FROM student_schedule sch JOIN student s ON s.id = sch.student_id
      WHERE s.centre_id = ${centre.id} AND s.first_name = 'Samarth'`);
    expect(rows.rows).toEqual([{ weekday: 1, starts_at: '16:00:00' }]);
  });

  /**
   * A file without day columns says nothing about the week. Reading that as "no days"
   * would wipe a schedule the centre had set up by hand.
   */
  it('leaves an existing schedule alone when the file has no day columns', async () => {
    const centre = await makeCentre(db, { name: 'NoDays' });
    await commitImport(
      { centreId: centre.id, plan: await analyzeImport(centre.id, LIBERTY, asDb(db)) },
      asDb(db),
    );

    const before = await db.execute(sql`
      SELECT count(*)::int n FROM student_schedule WHERE centre_id = ${centre.id}`);
    expect((before.rows[0] as { n: number }).n).toBe(4);

    // The same students, in a file that carries no weekday columns at all.
    const noDays = csv([
      ['S. No.', 'Student Last ', 'Student Name', 'Math', 'Read', "Father's Name", 'Cell'],
      ['1', 'Khandelwal', 'Samarth Khandelwal', 'Y', 'Y', 'Manish Khandelwal', '860-989-7952'],
      ['2', 'Moss', 'Jude Moss', 'Y', '', 'Peter Moss', '513-555-0112'],
    ]);
    const plan = await analyzeImport(centre.id, noDays, asDb(db));
    expect(plan.items.every((i) => i.candidate.schedule === null)).toBe(true);
    await commitImport({ centreId: centre.id, plan }, asDb(db));

    const after = await db.execute(sql`
      SELECT count(*)::int n FROM student_schedule WHERE centre_id = ${centre.id}`);
    expect((after.rows[0] as { n: number }).n).toBe(4);
  });

  /**
   * A file that HAS day columns and ticks none of them is different: that student has
   * come off the timetable and their rows should go.
   */
  it('clears a week when the file has day columns and ticks none', async () => {
    const centre = await makeCentre(db, { name: 'Cleared' });
    await commitImport(
      { centreId: centre.id, plan: await analyzeImport(centre.id, LIBERTY, asDb(db)) },
      asDb(db),
    );

    const off = csv([
      HEADER,
      ['1', 'Khandelwal', 'Samarth Khandelwal', 'Y', 'Y', 'M',
        '', '', '', '', '', '', 'Samarth Khandelwal', 'Manish Khandelwal', '860-989-7952'],
    ]);
    await commitImport(
      { centreId: centre.id, plan: await analyzeImport(centre.id, off, asDb(db)) },
      asDb(db),
    );

    const rows = await db.execute(sql`
      SELECT count(*)::int n FROM student_schedule sch JOIN student s ON s.id = sch.student_id
      WHERE s.centre_id = ${centre.id} AND s.first_name = 'Samarth'`);
    expect((rows.rows[0] as { n: number }).n).toBe(0);
  });

  it('merges the week across one row per subject', async () => {
    const centre = await makeCentre(db, { name: 'Tall' });
    // The tall shape: same student twice, one row per subject, each row carrying
    // only part of the week.
    const tall = csv([
      ['Student ID', 'Student Name', 'Program', 'Mon', 'Thu', 'Mon', 'Thu'],
      ['K-1', 'Chen, Aiden', 'Math', '1', '', '4:00 PM', ''],
      ['K-1', 'Chen, Aiden', 'Reading', '', '1', '', '5:00 PM'],
    ]);
    const plan = await analyzeImport(centre.id, tall, asDb(db));
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]!.candidate.schedule).toEqual([
      { weekday: 1, startsAt: '16:00:00', note: null },
      { weekday: 4, startsAt: '17:00:00', note: null },
    ]);

    await commitImport({ centreId: centre.id, plan }, asDb(db));
    const student = await db.execute(sql`
      SELECT id FROM student WHERE centre_id = ${centre.id} LIMIT 1`);
    const week = await scheduleForStudent(
      (student.rows[0] as { id: string }).id,
      asDb(db),
    );
    expect(week.map((w) => w.weekday)).toEqual([1, 4]);
  });

  it('keeps each centre schedule to itself', async () => {
    const a = await makeCentre(db, { name: 'Centre A' });
    const b = await makeCentre(db, { name: 'Centre B' });
    await commitImport(
      { centreId: a.id, plan: await analyzeImport(a.id, LIBERTY, asDb(db)) },
      asDb(db),
    );

    const leaked = await db.execute(sql`
      SELECT count(*)::int n FROM student_schedule WHERE centre_id = ${b.id}`);
    expect((leaked.rows[0] as { n: number }).n).toBe(0);

    // And no schedule row ever points at a student from another centre.
    const crossed = await db.execute(sql`
      SELECT count(*)::int n FROM student_schedule sch
      JOIN student s ON s.id = sch.student_id WHERE s.centre_id <> sch.centre_id`);
    expect((crossed.rows[0] as { n: number }).n).toBe(0);
  });
});
