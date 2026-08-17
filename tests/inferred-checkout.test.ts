import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  addEvent,
  asDb,
  createTestDb,
  makeCentre,
  makeStudent,
  makeUser,
  type TestDb,
} from './helpers/db';
import { resolveOpenSessions, INFERENCE_BASIS } from '@/lib/attendance/resolve';
import { confirmInferredCheckOut } from '@/lib/attendance/commands';
import { sessionsInRange, unconfirmedInferredSessions } from '@/lib/attendance/queries';
import { instantFromLocal } from '@/lib/time/centre-time';

const TZ = 'America/New_York';
const DAY = '2026-05-12';

describe('automatic checkout resolution', () => {
  let db: TestDb;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    ({ db, cleanup } = await createTestDb());
  });
  afterAll(() => cleanup());

  it('closes a session left open past close_time + 60 minutes', async () => {
    const centre = await makeCentre(db, { timezone: TZ, closeTime: '19:00:00' });
    const student = await makeStudent(db, centre.id);
    await addEvent(db, {
      centreId: centre.id,
      studentId: student.id,
      type: 'check_in',
      occurredAt: instantFromLocal(DAY, { hour: 18, minute: 0 }, TZ),
    });

    const results = await resolveOpenSessions(
      instantFromLocal(DAY, { hour: 20, minute: 1 }, TZ),
      asDb(db),
    );
    expect(results.find((r) => r.centreId === centre.id)!.inserted).toBe(1);

    const rows = await db.execute(sql`
      SELECT type, capture_method, inference_basis,
             (occurred_at AT TIME ZONE ${TZ})::text AS local_time
      FROM attendance_event
      WHERE student_id = ${student.id} AND capture_method = 'inferred'
    `);
    const row = rows.rows[0] as {
      type: string;
      capture_method: string;
      inference_basis: string;
      local_time: string;
    };
    expect(row.type).toBe('check_out');
    expect(row.capture_method).toBe('inferred');
    expect(row.inference_basis).toBe(INFERENCE_BASIS);
    // The recorded time is closing time, not the moment the job happened to run.
    expect(row.local_time).toContain('19:00:00');
  });

  it('does not close a session before the grace period has elapsed', async () => {
    const centre = await makeCentre(db, { timezone: TZ, closeTime: '19:00:00' });
    const student = await makeStudent(db, centre.id);
    await addEvent(db, {
      centreId: centre.id, studentId: student.id, type: 'check_in',
      occurredAt: instantFromLocal(DAY, { hour: 18, minute: 0 }, TZ),
    });

    // 19:30 local — past closing, but inside the 60-minute grace window.
    const results = await resolveOpenSessions(
      instantFromLocal(DAY, { hour: 19, minute: 30 }, TZ),
      asDb(db),
    );
    expect(results.find((r) => r.centreId === centre.id)!.inserted).toBe(0);
  });

  it('is idempotent: a second run inserts nothing', async () => {
    const centre = await makeCentre(db, { timezone: TZ, closeTime: '19:00:00' });
    const student = await makeStudent(db, centre.id);
    await addEvent(db, {
      centreId: centre.id, studentId: student.id, type: 'check_in',
      occurredAt: instantFromLocal(DAY, { hour: 18, minute: 0 }, TZ),
    });

    const at = instantFromLocal(DAY, { hour: 20, minute: 1 }, TZ);
    const first = await resolveOpenSessions(at, asDb(db));
    const second = await resolveOpenSessions(
      instantFromLocal(DAY, { hour: 21, minute: 1 }, TZ),
      asDb(db),
    );

    expect(first.find((r) => r.centreId === centre.id)!.inserted).toBe(1);
    expect(second.find((r) => r.centreId === centre.id)!.inserted).toBe(0);

    const count = await db.execute(sql`
      SELECT count(*)::int n FROM attendance_event
      WHERE student_id = ${student.id} AND capture_method = 'inferred'
    `);
    expect((count.rows[0] as { n: number }).n).toBe(1);
  });

  it('leaves an already checked-out student alone', async () => {
    const centre = await makeCentre(db, { timezone: TZ, closeTime: '19:00:00' });
    const student = await makeStudent(db, centre.id);
    await addEvent(db, {
      centreId: centre.id, studentId: student.id, type: 'check_in',
      occurredAt: instantFromLocal(DAY, { hour: 15, minute: 0 }, TZ),
    });
    await addEvent(db, {
      centreId: centre.id, studentId: student.id, type: 'check_out',
      occurredAt: instantFromLocal(DAY, { hour: 16, minute: 0 }, TZ),
    });

    const results = await resolveOpenSessions(
      instantFromLocal(DAY, { hour: 20, minute: 1 }, TZ),
      asDb(db),
    );
    expect(results.find((r) => r.centreId === centre.id)!.inserted).toBe(0);
  });

  it('surfaces the estimate as estimated, never as observed', async () => {
    const centre = await makeCentre(db, { timezone: TZ, closeTime: '19:00:00' });
    const student = await makeStudent(db, centre.id);
    await addEvent(db, {
      centreId: centre.id, studentId: student.id, type: 'check_in',
      occurredAt: instantFromLocal(DAY, { hour: 18, minute: 0 }, TZ),
    });
    const at = instantFromLocal(DAY, { hour: 20, minute: 1 }, TZ);
    await resolveOpenSessions(at, asDb(db));

    const sessions = await sessionsInRange(centre.id, DAY, DAY, {}, asDb(db));
    const session = sessions.find((s) => s.studentId === student.id)!;
    expect(session.isEstimated).toBe(true);
    expect(session.checkOutMethod).toBe('inferred');
    expect(session.checkOutBasis).toBe(INFERENCE_BASIS);
    expect(session.isOpen).toBe(false);
  });

  it('confirming inserts a NEW staff event and keeps the inference in the log', async () => {
    const centre = await makeCentre(db, { timezone: TZ, closeTime: '19:00:00' });
    const user = await makeUser(db, centre.id);
    const student = await makeStudent(db, centre.id);
    await addEvent(db, {
      centreId: centre.id, studentId: student.id, type: 'check_in',
      occurredAt: instantFromLocal(DAY, { hour: 18, minute: 0 }, TZ),
    });
    const at = instantFromLocal(DAY, { hour: 20, minute: 1 }, TZ);
    await resolveOpenSessions(at, asDb(db));

    const pending = await unconfirmedInferredSessions(centre.id, TZ, at, asDb(db));
    expect(pending).toHaveLength(1);

    const inferredRow = (
      await db.execute(sql`
        SELECT id, occurred_at FROM attendance_event
        WHERE student_id = ${student.id} AND capture_method = 'inferred'
      `)
    ).rows[0] as { id: string; occurred_at: string };

    await confirmInferredCheckOut(
      {
        inferredEventId: inferredRow.id,
        centreId: centre.id,
        studentId: student.id,
        occurredAt: new Date(inferredRow.occurred_at),
        confirmedBy: user.id,
        at,
      },
      asDb(db),
    );

    // The original inference is still there — the log is append-only.
    const all = await db.execute(sql`
      SELECT capture_method, confirmed_by, supersedes_id
      FROM attendance_event
      WHERE student_id = ${student.id} AND type = 'check_out'
      ORDER BY created_at
    `);
    const methods = (all.rows as { capture_method: string }[]).map((r) => r.capture_method);
    expect(methods).toEqual(['inferred', 'staff']);

    const staffRow = all.rows[1] as { confirmed_by: string; supersedes_id: string };
    expect(staffRow.confirmed_by).toBe(user.id);
    expect(staffRow.supersedes_id).toBe(inferredRow.id);

    // And it no longer reads as estimated anywhere.
    const after = await sessionsInRange(centre.id, DAY, DAY, { studentId: student.id }, asDb(db));
    expect(after[0]!.isEstimated).toBe(false);
    expect(after[0]!.checkOutMethod).toBe('staff');
    expect(await unconfirmedInferredSessions(centre.id, TZ, at, asDb(db))).toHaveLength(0);
  });

  it('surfaces a backlog of unreviewed estimates, each targetable on its own', async () => {
    const centre = await makeCentre(db, { timezone: TZ, closeTime: '19:00:00' });
    const user = await makeUser(db, centre.id);
    const student = await makeStudent(db, centre.id);

    // Three separate days where the student forgot to check out.
    const days = ['2026-05-10', '2026-05-11', '2026-05-12'];
    for (const day of days) {
      await addEvent(db, {
        centreId: centre.id, studentId: student.id, type: 'check_in',
        occurredAt: instantFromLocal(day, { hour: 16, minute: 0 }, TZ),
      });
      await resolveOpenSessions(instantFromLocal(day, { hour: 20, minute: 30 }, TZ), asDb(db));
    }

    const now = instantFromLocal('2026-05-12', { hour: 21, minute: 0 }, TZ);
    const pending = await unconfirmedInferredSessions(centre.id, TZ, now, asDb(db));
    expect(pending).toHaveLength(3);
    // Every row must carry the id of its own check-out, or the Day screen cannot
    // confirm the record the instructor actually clicked.
    expect(new Set(pending.map((p) => p.checkOutId)).size).toBe(3);
    for (const row of pending) expect(row.checkOutId).toBeTruthy();

    // Confirming the OLDEST must clear that one and leave the others untouched.
    const oldest = pending.find((p) => p.sessionDate === '2026-05-10')!;
    await confirmInferredCheckOut(
      {
        inferredEventId: oldest.checkOutId!,
        centreId: centre.id,
        studentId: student.id,
        occurredAt: oldest.checkOutAt!,
        confirmedBy: user.id,
        at: now,
      },
      asDb(db),
    );

    const after = await unconfirmedInferredSessions(centre.id, TZ, now, asDb(db));
    expect(after.map((p) => p.sessionDate).sort()).toEqual(['2026-05-11', '2026-05-12']);

    const confirmedDay = await sessionsInRange(
      centre.id, '2026-05-10', '2026-05-10', { studentId: student.id }, asDb(db),
    );
    expect(confirmedDay[0]!.isEstimated).toBe(false);
    expect(confirmedDay[0]!.checkOutMethod).toBe('staff');
  });

  it('resolves each centre against its own closing time and timezone', async () => {
    const east = await makeCentre(db, { timezone: 'America/New_York', closeTime: '19:00:00' });
    const west = await makeCentre(db, { timezone: 'America/Los_Angeles', closeTime: '19:00:00' });
    const eastStudent = await makeStudent(db, east.id);
    const westStudent = await makeStudent(db, west.id);

    await addEvent(db, {
      centreId: east.id, studentId: eastStudent.id, type: 'check_in',
      occurredAt: instantFromLocal(DAY, { hour: 18, minute: 0 }, 'America/New_York'),
    });
    await addEvent(db, {
      centreId: west.id, studentId: westStudent.id, type: 'check_in',
      occurredAt: instantFromLocal(DAY, { hour: 18, minute: 0 }, 'America/Los_Angeles'),
    });

    // 20:01 Eastern is only 17:01 Pacific — the west centre is still open.
    const results = await resolveOpenSessions(
      instantFromLocal(DAY, { hour: 20, minute: 1 }, 'America/New_York'),
      asDb(db),
    );
    expect(results.find((r) => r.centreId === east.id)!.inserted).toBe(1);
    expect(results.find((r) => r.centreId === west.id)!.inserted).toBe(0);
  });
});
