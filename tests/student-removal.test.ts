import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { addEvent, createTestDb, makeCentre, makeGuardian, makeStudent, type TestDb } from './helpers/db';

let db: TestDb;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterAll(() => cleanup());

const countStudents = async (centreId: string) =>
  ((await db.execute(sql`SELECT count(*)::int n FROM student WHERE centre_id = ${centreId}`))
    .rows[0] as { n: number }).n;

describe('removing a student', () => {
  /**
   * The guarantee the UI depends on. `removeStudentAction` chooses deactivate-vs-delete
   * from the event count, but the reason that choice is *safe* is that the database
   * would refuse the delete anyway — so this asserts the floor under the feature, not
   * the feature's own good manners.
   */
  it('cannot hard-delete a student who has attendance history', async () => {
    const centre = await makeCentre(db);
    const student = await makeStudent(db, centre.id, { firstName: 'Kept', lastInitial: 'H' });
    await addEvent(db, {
      centreId: centre.id,
      studentId: student.id,
      type: 'check_in',
      occurredAt: new Date('2026-05-11T18:00:00Z'),
    });

    // student_id cascades, and the BEFORE DELETE trigger on attendance_event raises.
    // Drizzle wraps the driver error, so the trigger's own words are on the cause —
    // asserted specifically, so this cannot pass on some unrelated query failure.
    const err: unknown = await db
      .execute(sql`DELETE FROM student WHERE id = ${student.id}`)
      .then(() => null)
      .catch((e: unknown) => e);
    expect(err).not.toBeNull();
    const message = [
      (err as { message?: string })?.message,
      ((err as { cause?: { message?: string } })?.cause)?.message,
    ].join(' ');
    expect(message).toMatch(/append-only/i);

    expect(await countStudents(centre.id)).toBe(1);
    const events = await db.execute(
      sql`SELECT count(*)::int n FROM attendance_event WHERE student_id = ${student.id}`,
    );
    expect((events.rows[0] as { n: number }).n).toBe(1);
  });

  it('deactivating keeps the student and every event they have', async () => {
    const centre = await makeCentre(db);
    const student = await makeStudent(db, centre.id, { firstName: 'Left', lastInitial: 'C' });
    await addEvent(db, {
      centreId: centre.id,
      studentId: student.id,
      type: 'check_in',
      occurredAt: new Date('2026-05-12T18:00:00Z'),
    });

    await db.execute(sql`UPDATE student SET status='inactive' WHERE id = ${student.id}`);

    const row = await db.execute(
      sql`SELECT status, (SELECT count(*)::int FROM attendance_event WHERE student_id = ${student.id}) AS events
          FROM student WHERE id = ${student.id}`,
    );
    expect(row.rows[0]).toMatchObject({ status: 'inactive', events: 1 });
  });

  it('a student with no history deletes cleanly, taking credentials and links with them', async () => {
    const centre = await makeCentre(db);
    const student = await makeStudent(db, centre.id, { firstName: 'Mistake', lastInitial: 'X' });
    await makeGuardian(db, centre.id, student.id, { name: 'Only Parent' });
    await db.execute(sql`
      INSERT INTO credential (centre_id, student_id, kind, token_hash)
      VALUES (${centre.id}, ${student.id}, 'qr', 'test-hash')
    `);
    await db.execute(sql`
      INSERT INTO student_import_key (centre_id, student_id, key_kind, key_value)
      VALUES (${centre.id}, ${student.id}, 'source_id', 'row-42')
    `);

    await db.execute(sql`DELETE FROM student WHERE id = ${student.id}`);

    expect(await countStudents(centre.id)).toBe(0);
    for (const table of ['credential', 'student_guardian', 'student_import_key']) {
      const left = await db.execute(
        sql.raw(`SELECT count(*)::int n FROM ${table} WHERE student_id = '${student.id}'`),
      );
      expect((left.rows[0] as { n: number }).n).toBe(0);
    }
  });

  it('a guardian with another child is not swept up by the orphan cleanup', async () => {
    const centre = await makeCentre(db);
    const goes = await makeStudent(db, centre.id, { firstName: 'Goes', lastInitial: 'S' });
    const stays = await makeStudent(db, centre.id, { firstName: 'Stays', lastInitial: 'S' });

    // One guardian, two children — the sibling shape the roster import produces.
    const guardian = await makeGuardian(db, centre.id, goes.id, { name: 'Shared Parent' });
    await db.execute(sql`
      INSERT INTO student_guardian (student_id, guardian_id, is_primary)
      VALUES (${stays.id}, ${guardian.id}, true)
    `);

    await db.execute(sql`DELETE FROM student WHERE id = ${goes.id}`);
    await db.execute(sql`
      DELETE FROM guardian g
      WHERE g.centre_id = ${centre.id}
        AND NOT EXISTS (SELECT 1 FROM student_guardian sg WHERE sg.guardian_id = g.id)
    `);

    const left = await db.execute(
      sql`SELECT count(*)::int n FROM guardian WHERE id = ${guardian.id}`,
    );
    // Deleting one child must not take the other child's contact details with it.
    expect((left.rows[0] as { n: number }).n).toBe(1);
  });

  it('the orphan cleanup does remove a guardian whose only child is gone', async () => {
    const centre = await makeCentre(db);
    const student = await makeStudent(db, centre.id, { firstName: 'Solo', lastInitial: 'P' });
    const guardian = await makeGuardian(db, centre.id, student.id, { name: 'Sole Parent' });

    await db.execute(sql`DELETE FROM student WHERE id = ${student.id}`);
    await db.execute(sql`
      DELETE FROM guardian g
      WHERE g.centre_id = ${centre.id}
        AND NOT EXISTS (SELECT 1 FROM student_guardian sg WHERE sg.guardian_id = g.id)
    `);

    const left = await db.execute(
      sql`SELECT count(*)::int n FROM guardian WHERE id = ${guardian.id}`,
    );
    expect((left.rows[0] as { n: number }).n).toBe(0);
  });
});
