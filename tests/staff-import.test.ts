import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { asDb, createTestDb, makeCentre, makeUser, type TestDb } from './helpers/db';
import { verifyPassword } from '@/lib/auth/password';
import { analyzeStaffImport, commitStaffImport, normalizeRole } from '@/lib/staff/import';
import { shiftLogCsv, staffForExport, staffListCsv } from '@/lib/staff/export';
import { clockIn, clockOut } from '@/lib/staff/shifts';
import { localDateString } from '@/lib/time/centre-time';

function csv(rows: string[][]): Buffer {
  return Buffer.from(
    rows
      .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','))
      .join('\n'),
    'utf8',
  );
}

/**
 * A messy export: title banner, a blank line, and job titles rather than roles.
 *
 * Addresses are tagged per test because email is unique across the whole system, not
 * per centre — reusing one across two test centres is exactly the collision the
 * importer refuses, and it would refuse it here too.
 */
function messy(tag: string) {
  return {
    anita: `anita-${tag}@example.com`,
    devon: `devon-${tag}@example.com`,
    marcus: `marcus-${tag}@example.com`,
    file: csv([
      ['Kumon of Somewhere — Team', '', ''],
      ['Generated 12 May 2026', '', ''],
      ['', '', ''],
      ['Staff Name', 'Email Address', 'Position'],
      ['Raghavan, Anita', `Anita-${tag}@Example.Com`, 'Centre Instructor'],
      ['Devon Ruiz', `devon-${tag}@example.com`, 'Assistant'],
      ['Marcus Bell', `marcus-${tag}@example.com`, 'Room Aide'],
    ]),
  };
}

async function staffRows(db: TestDb, centreId: string) {
  const res = await db.execute(sql`
    SELECT name, email, role FROM "user" WHERE centre_id = ${centreId} ORDER BY email
  `);
  return res.rows as { name: string; email: string; role: string }[];
}

describe('staff import', () => {
  let db: TestDb;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    ({ db, cleanup } = await createTestDb());
  });
  afterAll(() => cleanup());

  it('finds the header row below a title banner and maps name, email and role', async () => {
    const centre = await makeCentre(db);
    const plan = await analyzeStaffImport(centre.id, messy('headers').file, asDb(db));

    expect(plan.headerRowIndex).toBe(2); // blank rows are dropped at parse time
    expect(plan.mapping.name).toBe(0);
    expect(plan.mapping.email).toBe(1);
    expect(plan.mapping.role).toBe(2);
    expect(plan.unmappedHeaders).toHaveLength(0);
    expect(plan.counts).toMatchObject({ new: 3, updated: 0, unchanged: 0, blocked: 0 });
  });

  it('creates accounts with a working temporary password that is shown exactly once', async () => {
    const centre = await makeCentre(db);
    const actor = await makeUser(db, centre.id, { email: 'owner-a@example.com' });
    const file = messy('create');

    const plan = await analyzeStaffImport(centre.id, file.file, asDb(db));
    const result = await commitStaffImport(
      { centreId: centre.id, actorUserId: actor.id, plan },
      asDb(db),
    );

    expect(result.created).toBe(3);
    expect(result.newAccounts).toHaveLength(3);

    const anita = result.newAccounts.find((a) => a.email === file.anita)!;
    expect(anita.name).toBe('Anita Raghavan');
    expect(anita.role).toBe('instructor');

    // The password is real: it verifies against what was stored, and what was stored
    // is a hash rather than the password itself.
    const res = await db.execute(sql`
      SELECT password_hash FROM "user" WHERE email = ${file.anita}
    `);
    const stored = (res.rows[0] as { password_hash: string }).password_hash;
    expect(stored).not.toContain(anita.temporaryPassword);
    expect(await verifyPassword(anita.temporaryPassword, stored)).toBe(true);
  });

  it('lower-cases the email it matches on, so casing in the file is not a new account', async () => {
    const centre = await makeCentre(db);
    const actor = await makeUser(db, centre.id, { email: 'owner-b@example.com' });
    const file = messy('casing');
    await commitStaffImport(
      { centreId: centre.id, actorUserId: actor.id, plan: await analyzeStaffImport(centre.id, file.file, asDb(db)) },
      asDb(db),
    );

    const shouting = csv([
      ['Staff Name', 'Email Address', 'Position'],
      ['Anita Raghavan', file.anita.toUpperCase(), 'Instructor'],
    ]);
    const plan = await analyzeStaffImport(centre.id, shouting, asDb(db));
    expect(plan.counts).toMatchObject({ new: 0, unchanged: 1 });
  });

  it('is idempotent: importing the same file twice changes nothing', async () => {
    const centre = await makeCentre(db);
    const actor = await makeUser(db, centre.id, { email: 'owner-c@example.com' });
    const file = messy('idempotent');

    const first = await analyzeStaffImport(centre.id, file.file, asDb(db));
    await commitStaffImport({ centreId: centre.id, actorUserId: actor.id, plan: first }, asDb(db));
    const afterFirst = await staffRows(db, centre.id);

    const second = await analyzeStaffImport(centre.id, file.file, asDb(db));
    expect(second.counts).toMatchObject({ new: 0, updated: 0, unchanged: 3, blocked: 0 });

    const result = await commitStaffImport(
      { centreId: centre.id, actorUserId: actor.id, plan: second },
      asDb(db),
    );
    expect(result).toMatchObject({ created: 0, updated: 0, unchanged: 3 });
    expect(result.newAccounts).toHaveLength(0);
    expect(await staffRows(db, centre.id)).toEqual(afterFirst);
  });

  it('applies a genuine change and only that change', async () => {
    const centre = await makeCentre(db);
    const actor = await makeUser(db, centre.id, { email: 'owner-d@example.com' });
    const file = messy('change');
    await commitStaffImport(
      { centreId: centre.id, actorUserId: actor.id, plan: await analyzeStaffImport(centre.id, file.file, asDb(db)) },
      asDb(db),
    );

    const changed = csv([
      ['Staff Name', 'Email Address', 'Position'],
      ['Anita Raghavan', file.anita, 'Centre Instructor'],
      ['Devon Ruiz-Alvarez', file.devon, 'Assistant'],
      ['Marcus Bell', file.marcus, 'Room Aide'],
    ]);

    const plan = await analyzeStaffImport(centre.id, changed, asDb(db));
    expect(plan.counts).toMatchObject({ new: 0, updated: 1, unchanged: 2 });
    const devon = plan.items.find((i) => i.candidate.email === file.devon)!;
    expect(devon.changes).toEqual([
      { field: 'Name', from: 'Devon Ruiz', to: 'Devon Ruiz-Alvarez' },
    ]);

    const result = await commitStaffImport(
      { centreId: centre.id, actorUserId: actor.id, plan },
      asDb(db),
    );
    expect(result).toMatchObject({ created: 0, updated: 1, unchanged: 2 });
  });

  it('never reads a password out of the file', async () => {
    const centre = await makeCentre(db);
    const actor = await makeUser(db, centre.id, { email: 'owner-e@example.com' });

    const withPassword = csv([
      ['Name', 'Email', 'Role', 'Password'],
      ['Nadia Osei', 'nadia@example.com', 'Assistant', 'hunter2'],
    ]);

    const plan = await analyzeStaffImport(centre.id, withPassword, asDb(db));
    // The column is not merely ignored quietly — it is reported as ignored.
    expect(plan.unmappedHeaders).toContain('Password');

    await commitStaffImport({ centreId: centre.id, actorUserId: actor.id, plan }, asDb(db));
    const res = await db.execute(sql`
      SELECT password_hash FROM "user" WHERE email = 'nadia@example.com'
    `);
    const stored = (res.rows[0] as { password_hash: string }).password_hash;
    expect(await verifyPassword('hunter2', stored)).toBe(false);
  });

  it('leaves an existing account’s password alone when the row updates it', async () => {
    const centre = await makeCentre(db);
    const actor = await makeUser(db, centre.id, { email: 'owner-f@example.com' });
    // makeUser sets 'password123'.
    const person = await makeUser(db, centre.id, {
      email: 'kofi@example.com',
      name: 'Kofi Bell',
      role: 'assistant',
    });

    const file = csv([
      ['Name', 'Email', 'Role'],
      ['Kofi Bell-Mensah', 'kofi@example.com', 'Assistant'],
    ]);
    await commitStaffImport(
      { centreId: centre.id, actorUserId: actor.id, plan: await analyzeStaffImport(centre.id, file, asDb(db)) },
      asDb(db),
    );

    const res = await db.execute(sql`
      SELECT name, password_hash FROM "user" WHERE id = ${person.id}
    `);
    const row = res.rows[0] as { name: string; password_hash: string };
    expect(row.name).toBe('Kofi Bell-Mensah');
    // Renaming a colleague must not sign them out of their own account.
    expect(await verifyPassword('password123', row.password_hash)).toBe(true);
  });

  it('blocks an email that belongs to another centre, and leaves that account untouched', async () => {
    const a = await makeCentre(db, { name: 'Centre A' });
    const b = await makeCentre(db, { name: 'Centre B' });
    const actor = await makeUser(db, a.id, { email: 'owner-g@example.com' });
    const theirs = await makeUser(db, b.id, {
      email: 'shared@example.com',
      name: 'Belongs To B',
      role: 'assistant',
    });

    const file = csv([
      ['Name', 'Email', 'Role'],
      ['Not Their Name', 'shared@example.com', 'Instructor'],
    ]);
    const plan = await analyzeStaffImport(a.id, file, asDb(db));
    expect(plan.counts.blocked).toBe(1);
    expect(plan.items[0]!.blockedReason).toContain('another centre');

    const result = await commitStaffImport(
      { centreId: a.id, actorUserId: actor.id, plan },
      asDb(db),
    );
    expect(result).toMatchObject({ created: 0, updated: 0, blocked: 1 });

    const res = await db.execute(sql`SELECT name, role FROM "user" WHERE id = ${theirs.id}`);
    expect(res.rows[0]).toMatchObject({ name: 'Belongs To B', role: 'assistant' });
  });

  it('blocks both copies when one email appears twice in a file', async () => {
    const centre = await makeCentre(db);
    const actor = await makeUser(db, centre.id, { email: 'owner-h@example.com' });

    const file = csv([
      ['Name', 'Email', 'Role'],
      ['Sam One', 'sam@example.com', 'Assistant'],
      ['Sam Two', 'sam@example.com', 'Instructor'],
    ]);
    const plan = await analyzeStaffImport(centre.id, file, asDb(db));

    // Letting the last row win would silently pick a role for somebody.
    expect(plan.counts.blocked).toBe(2);
    const result = await commitStaffImport(
      { centreId: centre.id, actorUserId: actor.id, plan },
      asDb(db),
    );
    expect(result.created).toBe(0);
    expect(await staffRows(db, centre.id)).toHaveLength(1);
  });

  it('blocks a row with no email, and one whose email is not an address', async () => {
    const centre = await makeCentre(db);
    const file = csv([
      ['Name', 'Email', 'Role'],
      ['No Address', '', 'Assistant'],
      ['Not An Address', 'see reception', 'Assistant'],
    ]);
    const plan = await analyzeStaffImport(centre.id, file, asDb(db));
    expect(plan.counts.blocked).toBe(2);
    expect(plan.items[0]!.blockedReason).toContain('No email address');
    expect(plan.items[1]!.blockedReason).toContain('not an email address');
  });

  it('refuses to import at all without an email column', async () => {
    const centre = await makeCentre(db);
    const file = csv([
      ['Name', 'Position'],
      ['Anita Raghavan', 'Instructor'],
    ]);
    await expect(analyzeStaffImport(centre.id, file, asDb(db))).rejects.toThrow(/email/i);
  });

  it('defaults an unrecognised role to assistant rather than guessing upward', async () => {
    expect(normalizeRole('Centre Instructor')).toEqual({ role: 'instructor', recognised: true });
    expect(normalizeRole('Room Aide')).toEqual({ role: 'assistant', recognised: true });
    expect(normalizeRole('')).toEqual({ role: 'assistant', recognised: false });
    expect(normalizeRole('Grade 3 Coordinator')).toEqual({ role: 'assistant', recognised: false });
    // Reads both ways, so it takes the smaller of the two and says it was unsure.
    expect(normalizeRole('Lead Tutor')).toEqual({ role: 'assistant', recognised: false });

    const centre = await makeCentre(db);
    const actor = await makeUser(db, centre.id, { email: 'owner-i@example.com' });
    const file = csv([
      ['Name', 'Email', 'Role'],
      ['Unclear Person', 'unclear@example.com', 'Grade 3 Coordinator'],
    ]);
    const plan = await analyzeStaffImport(centre.id, file, asDb(db));
    expect(plan.items[0]!.candidate.role).toBe('assistant');
    expect(plan.items[0]!.warnings[0]).toContain('not recognised');

    await commitStaffImport({ centreId: centre.id, actorUserId: actor.id, plan }, asDb(db));
    const rows = await staffRows(db, centre.id);
    expect(rows.find((r) => r.email === 'unclear@example.com')!.role).toBe('assistant');
  });

  it('an unrecognised role never demotes somebody who is already an instructor', async () => {
    const centre = await makeCentre(db);
    const actor = await makeUser(db, centre.id, { email: 'owner-j@example.com' });
    await makeUser(db, centre.id, {
      email: 'priya@example.com',
      name: 'Priya Nair',
      role: 'instructor',
    });

    const file = csv([
      ['Name', 'Email', 'Role'],
      ['Priya Nair', 'priya@example.com', 'Team Member'],
    ]);
    const plan = await analyzeStaffImport(centre.id, file, asDb(db));
    expect(plan.counts.unchanged).toBe(1);

    await commitStaffImport({ centreId: centre.id, actorUserId: actor.id, plan }, asDb(db));
    const rows = await staffRows(db, centre.id);
    expect(rows.find((r) => r.email === 'priya@example.com')!.role).toBe('instructor');
  });

  it('refuses to demote the person running the import', async () => {
    const centre = await makeCentre(db);
    const actor = await makeUser(db, centre.id, { email: 'owner-k@example.com', name: 'The Boss' });
    await makeUser(db, centre.id, { email: 'second@example.com', name: 'Second Boss' });

    const file = csv([
      ['Name', 'Email', 'Role'],
      ['The Boss', 'owner-k@example.com', 'Assistant'],
    ]);
    const plan = await analyzeStaffImport(centre.id, file, asDb(db));
    expect(plan.counts.updated).toBe(1); // the plan is willing; the commit is not

    const result = await commitStaffImport(
      { centreId: centre.id, actorUserId: actor.id, plan },
      asDb(db),
    );
    expect(result.refused).toEqual([
      { email: 'owner-k@example.com', reason: 'You cannot change your own role in an import.' },
    ]);

    const rows = await staffRows(db, centre.id);
    expect(rows.find((r) => r.email === 'owner-k@example.com')!.role).toBe('instructor');
  });

  it('refuses a demotion that would leave the centre with no instructor', async () => {
    const centre = await makeCentre(db);
    const actor = await makeUser(db, centre.id, { email: 'owner-l@example.com', name: 'One' });
    await makeUser(db, centre.id, { email: 'two@example.com', name: 'Two' });

    // Demoting both is the file that locks everybody out of /students and /compliance.
    const file = csv([
      ['Name', 'Email', 'Role'],
      ['One', 'owner-l@example.com', 'Assistant'],
      ['Two', 'two@example.com', 'Assistant'],
    ]);
    const result = await commitStaffImport(
      { centreId: centre.id, actorUserId: actor.id, plan: await analyzeStaffImport(centre.id, file, asDb(db)) },
      asDb(db),
    );

    expect(result.refused).toHaveLength(2);
    expect(result.refused.map((r) => r.reason)).toContain(
      'This would leave the centre with no instructor.',
    );
    const rows = await staffRows(db, centre.id);
    expect(rows.every((r) => r.role === 'instructor')).toBe(true);
  });

  it('allows a demotion when somebody else is left holding the role', async () => {
    const centre = await makeCentre(db);
    const actor = await makeUser(db, centre.id, { email: 'owner-m@example.com', name: 'Stays' });
    await makeUser(db, centre.id, { email: 'steps-down@example.com', name: 'Steps Down' });

    const file = csv([
      ['Name', 'Email', 'Role'],
      ['Steps Down', 'steps-down@example.com', 'Assistant'],
    ]);
    const result = await commitStaffImport(
      { centreId: centre.id, actorUserId: actor.id, plan: await analyzeStaffImport(centre.id, file, asDb(db)) },
      asDb(db),
    );

    expect(result.refused).toHaveLength(0);
    expect(result.updated).toBe(1);
    const rows = await staffRows(db, centre.id);
    expect(rows.find((r) => r.email === 'steps-down@example.com')!.role).toBe('assistant');
    expect(rows.find((r) => r.email === 'owner-m@example.com')!.role).toBe('instructor');
  });

  it('never removes somebody who is missing from the file', async () => {
    const centre = await makeCentre(db);
    const actor = await makeUser(db, centre.id, { email: 'owner-n@example.com' });
    const file = messy('partial');
    await commitStaffImport(
      { centreId: centre.id, actorUserId: actor.id, plan: await analyzeStaffImport(centre.id, file.file, asDb(db)) },
      asDb(db),
    );
    expect(await staffRows(db, centre.id)).toHaveLength(4);

    // A partial export must not empty the staff list.
    const partial = csv([
      ['Name', 'Email', 'Role'],
      ['Anita Raghavan', file.anita, 'Instructor'],
    ]);
    await commitStaffImport(
      { centreId: centre.id, actorUserId: actor.id, plan: await analyzeStaffImport(centre.id, partial, asDb(db)) },
      asDb(db),
    );
    expect(await staffRows(db, centre.id)).toHaveLength(4);
  });

  it('skips a row the instructor unticked in the review screen', async () => {
    const centre = await makeCentre(db);
    const actor = await makeUser(db, centre.id, { email: 'owner-o@example.com' });
    const file = messy('excluded');
    const plan = await analyzeStaffImport(centre.id, file.file, asDb(db));

    const result = await commitStaffImport(
      { centreId: centre.id, actorUserId: actor.id, plan, excluded: [0] },
      asDb(db),
    );
    expect(result).toMatchObject({ created: 2, skipped: 1 });
    const rows = await staffRows(db, centre.id);
    expect(rows.some((r) => r.email === file.anita)).toBe(false);
  });
});

describe('staff export', () => {
  let db: TestDb;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    ({ db, cleanup } = await createTestDb());
  });
  afterAll(() => cleanup());

  const TZ = 'America/New_York';
  const HOUR = 60 * 60_000;

  it('summarises each person’s shift record beside them, and never writes a hash', async () => {
    const centre = await makeCentre(db, { timezone: TZ });
    const worked = await makeUser(db, centre.id, {
      email: 'worked@example.com',
      name: 'Has Worked',
      role: 'assistant',
    });
    await makeUser(db, centre.id, { email: 'new-hire@example.com', name: 'New Hire' });

    const start = new Date('2026-03-10T18:00:00Z');
    const shift = await clockIn(worked.id, centre.id, start, asDb(db));
    await clockOut(
      { shiftId: shift.id, centreId: centre.id, byUserId: worked.id, at: new Date(start.getTime() + 4 * HOUR) },
      asDb(db),
    );
    // A second, still open.
    await clockIn(worked.id, centre.id, new Date(start.getTime() + 24 * HOUR), asDb(db));

    const rows = await staffForExport(centre.id, asDb(db));
    const row = rows.find((r) => r.email === 'worked@example.com')!;
    expect(row.shiftCount).toBe(2);
    expect(row.totalMinutes).toBe(240); // the open shift contributes no time
    expect(row.onShiftNow).toBe(true);

    const quiet = rows.find((r) => r.email === 'new-hire@example.com')!;
    expect(quiet.shiftCount).toBe(0);
    expect(quiet.totalMinutes).toBe(0);
    expect(quiet.lastShiftAt).toBeNull();
    expect(quiet.onShiftNow).toBe(false);

    const text = staffListCsv(centre.name, TZ, '2026-03-12', rows);
    expect(text).not.toMatch(/scrypt\$/);
    expect(text).not.toMatch(/password/i);
  });

  it('never shows another centre’s staff', async () => {
    const a = await makeCentre(db, { name: 'Export A' });
    const b = await makeCentre(db, { name: 'Export B' });
    await makeUser(db, a.id, { email: 'in-a@example.com', name: 'In A' });
    await makeUser(db, b.id, { email: 'in-b@example.com', name: 'In B' });

    const rows = await staffForExport(a.id, asDb(db));
    expect(rows.map((r) => r.email)).toEqual(['in-a@example.com']);
  });

  it('names an open shift rather than leaving the column blank', async () => {
    const centre = await makeCentre(db, { timezone: TZ, name: 'Open Shift Centre' });
    const person = await makeUser(db, centre.id, { email: 'open@example.com', name: 'Still Here' });
    const start = new Date(Date.now() - 2 * HOUR);
    await clockIn(person.id, centre.id, start, asDb(db));

    const text = await shiftLogCsv(
      {
        centreId: centre.id,
        centreName: centre.name,
        timezone: TZ,
        from: new Date(start.getTime() - HOUR),
        to: new Date(start.getTime() + HOUR),
      },
      asDb(db),
    );
    expect(text).toContain('still on shift');
    expect(text).toContain('open@example.com');
  });

  it('round-trips: the exported staff list re-imports as entirely unchanged', async () => {
    const centre = await makeCentre(db, { timezone: TZ, name: 'Round Trip' });
    const actor = await makeUser(db, centre.id, { email: 'rt-owner@example.com', name: 'Owner' });
    await makeUser(db, centre.id, {
      email: 'rt-assistant@example.com',
      name: 'Assistant Person',
      role: 'assistant',
    });

    const today = localDateString(new Date(), TZ);
    const text = staffListCsv(centre.name, TZ, today, await staffForExport(centre.id, asDb(db)));

    // The file an instructor downloads is the file the importer understands — column
    // headings included, title banner and all.
    const plan = await analyzeStaffImport(centre.id, Buffer.from(text, 'utf8'), asDb(db));
    expect(plan.counts).toMatchObject({ new: 0, updated: 0, unchanged: 2, blocked: 0 });

    const result = await commitStaffImport(
      { centreId: centre.id, actorUserId: actor.id, plan },
      asDb(db),
    );
    expect(result).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
  });
});
