import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { asDb, createTestDb, makeCentre, makeStudent, type TestDb } from './helpers/db';
import { analyzeImport } from '@/lib/import/analyze';
import { commitImport } from '@/lib/import/commit';

function csv(rows: string[][]): Buffer {
  return Buffer.from(
    rows
      .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','))
      .join('\n'),
    'utf8',
  );
}

/** A messy export: title banner, blank line, "Last, First", one row per subject. */
const MESSY = csv([
  ['Kumon of Somewhere — Roster', '', '', '', ''],
  ['Generated 12 May 2026', '', '', '', ''],
  ['', '', '', '', ''],
  ['Student ID', 'Student Name', 'Program', 'Parent/Guardian', 'Contact Number'],
  ['K-1', 'Chen, Aiden', 'Math', 'Wei Chen', '(312) 555-0101'],
  ['K-1', 'Chen, Aiden', 'Reading', 'Wei Chen', '(312) 555-0101'],
  ['K-2', 'Sharma, Emma', 'Math', 'Priya Sharma', '312-555-0102'],
  ['K-3', 'Smith, Emma', 'Reading', 'Sarah Smith', '3125550103'],
  ['K-4', 'Watson, Mary Jane', 'Math', 'Ann Watson', '312 555 0105'],
  ['K-5', 'deVries, Lucas Jr.', 'Math', 'Piet deVries', '312.555.0106'],
]);

async function rosterFingerprint(db: TestDb, centreId: string) {
  const res = await db.execute(sql`
    SELECT
      count(*)::int AS n,
      md5(string_agg(
        first_name || '|' || last_initial || '|' ||
        array_to_string(subjects, ',') || '|' || expected_minutes || '|' || status,
        '~' ORDER BY id
      )) AS hash
    FROM student WHERE centre_id = ${centreId}
  `);
  return res.rows[0] as { n: number; hash: string | null };
}

describe('roster import', () => {
  let db: TestDb;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    ({ db, cleanup } = await createTestDb());
  });
  afterAll(() => cleanup());

  it('finds the header row below a title banner and maps columns without help', async () => {
    const centre = await makeCentre(db);
    const plan = await analyzeImport(centre.id, MESSY, asDb(db));

    expect(plan.headerRowIndex).toBe(2); // blank rows are dropped at parse time
    expect(plan.mapping.sourceId).toBe(0);
    expect(plan.mapping.fullName).toBe(1);
    expect(plan.mapping.subject).toBe(2);
    expect(plan.mapping.guardianName).toBe(3);
    expect(plan.mapping.guardianPhone).toBe(4);
    expect(plan.unmappedHeaders).toHaveLength(0);
  });

  it('merges one row per student-subject into a single student', async () => {
    const centre = await makeCentre(db);
    const plan = await analyzeImport(centre.id, MESSY, asDb(db));

    const aiden = plan.items.find((i) => i.candidate.firstName === 'Aiden');
    expect(aiden).toBeDefined();
    expect(aiden!.candidate.subjects).toEqual(['Math', 'Reading']);
    expect(plan.items).toHaveLength(5);
  });

  it('splits "Last, First" and multi-word first names', async () => {
    const centre = await makeCentre(db);
    const plan = await analyzeImport(centre.id, MESSY, asDb(db));

    const mary = plan.items.find((i) => i.candidate.lastName === 'Watson');
    expect(mary!.candidate.firstName).toBe('Mary Jane');
    expect(mary!.candidate.lastInitial).toBe('W');

    // Internal capitalisation must survive.
    const lucas = plan.items.find((i) => i.candidate.firstName === 'Lucas');
    expect(lucas!.candidate.lastName).toBe('deVries');
    expect(lucas!.candidate.lastInitial).toBe('D');
  });

  it('normalises phone numbers to E.164 from several formats', async () => {
    const centre = await makeCentre(db);
    const plan = await analyzeImport(centre.id, MESSY, asDb(db));
    const phones = plan.items.map((i) => i.candidate.guardianPhone).sort();
    expect(phones).toEqual([
      '+13125550101',
      '+13125550102',
      '+13125550103',
      '+13125550105',
      '+13125550106',
    ]);
  });

  it('keeps two students who share a first name and last initial separate', async () => {
    const centre = await makeCentre(db);
    const plan = await analyzeImport(centre.id, MESSY, asDb(db));
    await commitImport({ centreId: centre.id, plan }, asDb(db));

    const emmas = await db.execute(sql`
      SELECT count(*)::int n FROM student
      WHERE centre_id = ${centre.id} AND first_name = 'Emma'
    `);
    // Emma Sharma and Emma Smith both render "Emma S." and must not be merged.
    expect((emmas.rows[0] as { n: number }).n).toBe(2);
  });

  it('is idempotent: importing the same file twice changes nothing', async () => {
    const centre = await makeCentre(db);

    const first = await analyzeImport(centre.id, MESSY, asDb(db));
    expect(first.counts).toMatchObject({ new: 5, updated: 0, unchanged: 0, ambiguous: 0 });
    const firstResult = await commitImport({ centreId: centre.id, plan: first }, asDb(db));
    expect(firstResult.created).toBe(5);

    const afterFirst = await rosterFingerprint(db, centre.id);

    const second = await analyzeImport(centre.id, MESSY, asDb(db));
    expect(second.counts.new).toBe(0);
    expect(second.counts.updated).toBe(0);
    expect(second.counts.unchanged).toBe(5);

    const secondResult = await commitImport({ centreId: centre.id, plan: second }, asDb(db));
    expect(secondResult.created).toBe(0);
    expect(secondResult.updated).toBe(0);

    const afterSecond = await rosterFingerprint(db, centre.id);
    expect(afterSecond.n).toBe(afterFirst.n);
    expect(afterSecond.hash).toBe(afterFirst.hash);
  });

  it('detects a genuine change and applies only that change', async () => {
    const centre = await makeCentre(db);
    await commitImport(
      { centreId: centre.id, plan: await analyzeImport(centre.id, MESSY, asDb(db)) },
      asDb(db),
    );

    const changed = csv([
      ['Student ID', 'Student Name', 'Program', 'Parent/Guardian', 'Contact Number'],
      ['K-1', 'Chen, Aiden', 'Math', 'Wei Chen', '(312) 555-0101'],
      ['K-1', 'Chen, Aiden', 'Reading', 'Wei Chen', '(312) 555-0101'],
      ['K-1', 'Chen, Aiden', 'Japanese', 'Wei Chen', '(312) 555-0101'],
      ['K-2', 'Sharma, Emma', 'Math', 'Priya Sharma', '312-555-0102'],
      ['K-3', 'Smith, Emma', 'Reading', 'Sarah Smith', '3125550103'],
      ['K-4', 'Watson, Mary Jane', 'Math', 'Ann Watson', '312 555 0105'],
      ['K-5', 'deVries, Lucas Jr.', 'Math', 'Piet deVries', '312.555.0106'],
    ]);

    const plan = await analyzeImport(centre.id, changed, asDb(db));
    expect(plan.counts.updated).toBe(1);
    expect(plan.counts.unchanged).toBe(4);
    const aiden = plan.items.find((i) => i.candidate.firstName === 'Aiden')!;
    expect(aiden.changes.map((c) => c.field)).toContain('Subjects');

    const result = await commitImport({ centreId: centre.id, plan }, asDb(db));
    expect(result.updated).toBe(1);
    expect(result.created).toBe(0);
  });

  it('recomputes the allowance when a student gains a subject', async () => {
    const centre = await makeCentre(db);

    const oneSubject = csv([
      ['Student ID', 'Student Name', 'Program'],
      ['K-9', 'Okafor, Zara', 'Math'],
    ]);
    await commitImport(
      { centreId: centre.id, plan: await analyzeImport(centre.id, oneSubject, asDb(db)) },
      asDb(db),
    );

    const readMinutes = async () => {
      const res = await db.execute(sql`
        SELECT expected_minutes::int m FROM student
        WHERE centre_id = ${centre.id} AND first_name = 'Zara'
      `);
      return (res.rows[0] as { m: number }).m;
    };
    expect(await readMinutes()).toBe(30);

    const twoSubjects = csv([
      ['Student ID', 'Student Name', 'Program'],
      ['K-9', 'Okafor, Zara', 'Math'],
      ['K-9', 'Okafor, Zara', 'Reading'],
    ]);

    // The file has no minutes column. The allowance still has to follow the subject
    // count — this used to update `subjects` and silently leave the old 30 behind, so
    // a two-subject student went amber on /floor halfway through a session they were
    // entitled to be in.
    const plan = await analyzeImport(centre.id, twoSubjects, asDb(db));
    const zara = plan.items.find((i) => i.candidate.firstName === 'Zara')!;
    expect(zara.changes.map((c) => c.field)).toEqual(
      expect.arrayContaining(['Subjects', 'Expected minutes']),
    );
    expect(zara.changes.find((c) => c.field === 'Expected minutes')).toMatchObject({
      from: '30',
      to: '60',
    });

    await commitImport({ centreId: centre.id, plan }, asDb(db));
    expect(await readMinutes()).toBe(60);

    // And re-importing that same file is still a no-op.
    const again = await analyzeImport(centre.id, twoSubjects, asDb(db));
    expect(again.counts).toMatchObject({ new: 0, updated: 0, unchanged: 1 });
    const before = await rosterFingerprint(db, centre.id);
    await commitImport({ centreId: centre.id, plan: again }, asDb(db));
    expect((await rosterFingerprint(db, centre.id)).hash).toBe(before.hash);
  });

  it('an explicit minutes column beats the subject count', async () => {
    const centre = await makeCentre(db);
    const file = csv([
      ['Student Name', 'Program', 'Session length'],
      ['Bell, Kofi', 'Math', '45'],
      ['Bell, Kofi', 'Reading', '45'],
    ]);
    await commitImport(
      { centreId: centre.id, plan: await analyzeImport(centre.id, file, asDb(db)) },
      asDb(db),
    );

    const res = await db.execute(sql`
      SELECT expected_minutes::int m FROM student
      WHERE centre_id = ${centre.id} AND first_name = 'Kofi'
    `);
    // The centre said 45, so 45 it is — not 60 from two subjects.
    expect((res.rows[0] as { m: number }).m).toBe(45);
  });

  it('never grants SMS consent from a spreadsheet', async () => {
    const centre = await makeCentre(db);
    await commitImport(
      { centreId: centre.id, plan: await analyzeImport(centre.id, MESSY, asDb(db)) },
      asDb(db),
    );

    const consented = await db.execute(sql`
      SELECT count(*)::int n FROM guardian
      WHERE centre_id = ${centre.id} AND sms_consent = true
    `);
    // A phone number in a file is not permission to text it.
    expect((consented.rows[0] as { n: number }).n).toBe(0);
  });

  it('flags an ambiguous match instead of guessing', async () => {
    const centre = await makeCentre(db);
    // Two existing students who both render "Emma S." and have no import keys.
    await makeStudent(db, centre.id, { firstName: 'Emma', lastInitial: 'S', subjects: ['Math'] });
    await makeStudent(db, centre.id, { firstName: 'Emma', lastInitial: 'S', subjects: ['Reading'] });

    const file = csv([
      ['Student Name', 'Program'],
      ['Stone, Emma', 'Math'],
    ]);
    const plan = await analyzeImport(centre.id, file, asDb(db));
    expect(plan.counts.ambiguous).toBe(1);
    expect(plan.items[0]!.options).toHaveLength(2);

    // Unresolved ambiguity is skipped, never guessed.
    const skipped = await commitImport({ centreId: centre.id, plan }, asDb(db));
    expect(skipped.skipped).toBe(1);
    expect(skipped.created).toBe(0);

    // Resolving it as a new student creates exactly one.
    const resolved = await commitImport(
      { centreId: centre.id, plan, resolutions: { 0: 'new' } },
      asDb(db),
    );
    expect(resolved.created).toBe(1);
  });

  /**
   * The real Kumon centre export: a serial number, a surname column beside a full
   * "Student Name", subjects as wide Y-flag columns, and a father's contact block
   * followed by a mother's. Every column header here appears verbatim in the files
   * the centres actually download.
   */
  const KUMON_WIDE = csv([
    ['S. No.', 'Student Last ', 'Student Name', 'Math', 'Read', 'Class',
      'Student Name', "Father's Name", 'Cell', 'e-mail', "Mother's Name", 'Cell', 'e-mail'],
    ['1', 'Khandelwal', 'Samarth Khandelwal', 'Y', 'Y', 'M',
      'Samarth Khandelwal', 'Manish Khandelwal', '860-989-7952', 'm@example.com',
      'Sonam Khandelwal', '513-668-6850', 's@example.com'],
    // Father's block is blank; only the mother can be reached.
    ['2', 'Achampong', 'Ava Achampong', 'Y', '', 'EL',
      'Ava Achampong', '', '', '', 'Adwoa Achampong', '571-282-5365', 'a@example.com'],
    // Neither parent has a phone: a name-only block is still worth keeping.
    ['3', 'Moss', 'Jude Moss', '', 'Y', 'M',
      'Jude Moss', 'Peter Moss', '', '', '', '', ''],
  ]);

  it('reads the wide Kumon export: full name beside a surname column', async () => {
    const centre = await makeCentre(db);
    const plan = await analyzeImport(centre.id, KUMON_WIDE, asDb(db));

    // "S. No." numbers the row, not the child, so it is not an id at all.
    expect(plan.mapping.sourceId).toBeUndefined();
    // The SECOND "Student Name" must not become a first name.
    expect(plan.mapping.fullName).toBe(2);
    expect(plan.mapping.firstName).toBeUndefined();

    expect(plan.items).toHaveLength(3);
    // The surname is not doubled onto the given name.
    expect(plan.items.map((i) => i.candidate.firstName)).toEqual(['Samarth', 'Ava', 'Jude']);
    expect(plan.items.map((i) => i.candidate.lastInitial)).toEqual(['K', 'A', 'M']);
  });

  it('turns wide Y-flag subject columns into subjects', async () => {
    const centre = await makeCentre(db);
    const plan = await analyzeImport(centre.id, KUMON_WIDE, asDb(db));

    expect(plan.mapping.subjectColumns).toEqual([
      { column: 3, subject: 'Math' },
      { column: 4, subject: 'Reading' },
    ]);
    expect(plan.items[0]!.candidate.subjects).toEqual(['Math', 'Reading']);
    expect(plan.items[1]!.candidate.subjects).toEqual(['Math']);
    // A blank flag is not enrolment, so this student is Reading only.
    expect(plan.items[2]!.candidate.subjects).toEqual(['Reading']);
  });

  it('does not treat a shifting serial number as a student identity', async () => {
    const centre = await makeCentre(db);
    const header = ['S. No.', 'Student Last ', 'Student Name', 'Math', 'Read', "Father's Name", 'Cell'];
    const august = csv([
      header,
      ['1', 'Humphrey', 'Chole Humphrey', 'Y', '', 'Rob Humphrey', '513-555-0201'],
      ['2', 'Livada', 'Luca Livada', 'Y', '', 'Ana Livada', '513-555-0202'],
    ]);
    // A student inserted above them pushes both serials down by one. Matching on the
    // serial would rename Chole into Luca and merge two children into one record.
    const september = csv([
      header,
      ['1', 'Miller', 'Makaylee Miller', 'Y', '', 'Kim Miller', '513-555-0203'],
      ['2', 'Humphrey', 'Chole Humphrey', 'Y', '', 'Rob Humphrey', '513-555-0201'],
      ['3', 'Livada', 'Luca Livada', 'Y', '', 'Ana Livada', '513-555-0202'],
    ]);

    await commitImport(
      { centreId: centre.id, plan: await analyzeImport(centre.id, august, asDb(db)) },
      asDb(db),
    );
    const second = await commitImport(
      { centreId: centre.id, plan: await analyzeImport(centre.id, september, asDb(db)) },
      asDb(db),
    );

    // Only the newcomer is created; the other two are recognised by name.
    expect(second).toMatchObject({ created: 1, updated: 0, unchanged: 2 });

    const names = await db.execute(sql`
      SELECT first_name, last_initial FROM student
      WHERE centre_id = ${centre.id} ORDER BY first_name`);
    expect(names.rows).toEqual([
      { first_name: 'Chole', last_initial: 'H' },
      { first_name: 'Luca', last_initial: 'L' },
      { first_name: 'Makaylee', last_initial: 'M' },
    ]);

    // No student ends up holding another child's identity.
    const conflated = await db.execute(sql`
      SELECT count(*)::int n FROM (
        SELECT student_id FROM student_import_key
        WHERE centre_id = ${centre.id} AND key_kind = 'full_name'
        GROUP BY student_id HAVING count(*) > 1
      ) t`);
    expect((conflated.rows[0] as { n: number }).n).toBe(0);
  });

  it('reads U as enrolled and N, D or blank as not', async () => {
    const centre = await makeCentre(db);
    const flags = csv([
      ['S. No.', 'Student Last ', 'Student Name', 'Math', 'Read', "Father's Name", 'Cell'],
      // "U" is enrolment with worksheets on hold, not an absence of enrolment.
      ['1', 'Gueddari', 'Ali Gueddari', 'U', 'U', 'Sami Gueddari', '513-555-0111'],
      ['2', 'Moss', 'Jude Moss', 'U', 'N', 'Peter Moss', '513-555-0112'],
      ['3', 'Shiffert', 'Destiny Shiffert', 'y', 'D', 'Dana Shiffert', '513-555-0113'],
    ]);
    const plan = await analyzeImport(centre.id, flags, asDb(db));

    expect(plan.items[0]!.candidate.subjects).toEqual(['Math', 'Reading']);
    expect(plan.items[1]!.candidate.subjects).toEqual(['Math']);
    // Lowercase "y" counts; "D" does not.
    expect(plan.items[2]!.candidate.subjects).toEqual(['Math']);
  });

  it('falls back to the second parent when the first has no contact', async () => {
    const centre = await makeCentre(db);
    const plan = await analyzeImport(centre.id, KUMON_WIDE, asDb(db));

    const [first, second, third] = plan.items.map((i) => i.candidate);
    expect(first!.guardianName).toBe('Manish Khandelwal');
    expect(first!.guardianPhone).toBe('+18609897952');
    // Father's block empty — the mother's is what reaches anyone.
    expect(second!.guardianName).toBe('Adwoa Achampong');
    expect(second!.guardianPhone).toBe('+15712825365');
    // No phone anywhere: keep the name rather than dropping the guardian.
    expect(third!.guardianName).toBe('Peter Moss');
    expect(third!.guardianPhone).toBeNull();
  });

  it('re-imports the wide export with no further writes', async () => {
    const centre = await makeCentre(db);
    const first = await commitImport(
      { centreId: centre.id, plan: await analyzeImport(centre.id, KUMON_WIDE, asDb(db)) },
      asDb(db),
    );
    expect(first.created).toBe(3);

    const before = await rosterFingerprint(db, centre.id);
    const second = await commitImport(
      { centreId: centre.id, plan: await analyzeImport(centre.id, KUMON_WIDE, asDb(db)) },
      asDb(db),
    );
    expect(second).toMatchObject({ created: 0, updated: 0, unchanged: 3 });
    expect(await rosterFingerprint(db, centre.id)).toEqual(before);
  });

  it('never writes attendance events during an import', async () => {
    const centre = await makeCentre(db);
    await commitImport(
      { centreId: centre.id, plan: await analyzeImport(centre.id, MESSY, asDb(db)) },
      asDb(db),
    );
    const events = await db.execute(sql`
      SELECT count(*)::int n FROM attendance_event WHERE centre_id = ${centre.id}
    `);
    expect((events.rows[0] as { n: number }).n).toBe(0);
  });
});
