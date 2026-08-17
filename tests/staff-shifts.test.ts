import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clockIn, clockOut, currentShift, shiftsInRange } from '@/lib/staff/shifts';
import { asDb, createTestDb, makeCentre, makeUser, type TestDb } from './helpers/db';

let db: TestDb;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  ({ db, cleanup } = await createTestDb());
});

afterAll(async () => {
  await cleanup();
});

const HOUR = 60 * 60_000;

describe('staff shifts', () => {
  it('records a duration from clock in to clock out', async () => {
    const centre = await makeCentre(db);
    const user = await makeUser(db, centre.id, { name: 'Devon Ruiz', role: 'assistant' });

    const start = new Date('2026-03-10T18:00:00Z');
    const shift = await clockIn(user.id, centre.id, start, asDb(db));
    expect(await currentShift(user.id, asDb(db))).not.toBeNull();

    const ended = await clockOut(
      { shiftId: shift.id, centreId: centre.id, byUserId: user.id, at: new Date(start.getTime() + 4 * HOUR) },
      asDb(db),
    );
    expect(ended).toBe(true);
    expect(await currentShift(user.id, asDb(db))).toBeNull();

    const rows = await shiftsInRange(
      centre.id,
      new Date(start.getTime() - HOUR),
      new Date(start.getTime() + 24 * HOUR),
      asDb(db),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.durationMinutes).toBe(240);
    expect(rows[0]!.userName).toBe('Devon Ruiz');
    expect(rows[0]!.role).toBe('assistant');
  });

  it('a second clock in while already on shift returns the open shift, not a new one', async () => {
    const centre = await makeCentre(db);
    const user = await makeUser(db, centre.id);

    const start = new Date('2026-03-11T18:00:00Z');
    const first = await clockIn(user.id, centre.id, start, asDb(db));
    // The double-tap. `staff_shift_one_open_per_user` is what makes this safe: without
    // it there would be two open shifts and every duration afterwards would be wrong.
    const second = await clockIn(user.id, centre.id, new Date(start.getTime() + 60_000), asDb(db));

    expect(second.id).toBe(first.id);
    expect(second.startedAt.getTime()).toBe(first.startedAt.getTime());

    const rows = await shiftsInRange(
      centre.id,
      new Date(start.getTime() - HOUR),
      new Date(start.getTime() + 24 * HOUR),
      asDb(db),
    );
    expect(rows).toHaveLength(1);
  });

  it('an open shift has no duration until it ends', async () => {
    const centre = await makeCentre(db);
    const user = await makeUser(db, centre.id);
    const start = new Date('2026-03-12T18:00:00Z');
    await clockIn(user.id, centre.id, start, asDb(db));

    const rows = await shiftsInRange(
      centre.id,
      new Date(start.getTime() - HOUR),
      new Date(start.getTime() + 24 * HOUR),
      asDb(db),
    );
    expect(rows[0]!.endedAt).toBeNull();
    expect(rows[0]!.durationMinutes).toBeNull();
  });

  it('records who closed a shift when it was not the person who worked it', async () => {
    const centre = await makeCentre(db);
    const worker = await makeUser(db, centre.id, { name: 'Marcus Bell', role: 'assistant' });
    const instructor = await makeUser(db, centre.id, { name: 'Anita Raghavan' });

    const start = new Date('2026-03-13T18:00:00Z');
    const shift = await clockIn(worker.id, centre.id, start, asDb(db));
    await clockOut(
      { shiftId: shift.id, centreId: centre.id, byUserId: instructor.id, at: new Date(start.getTime() + 5 * HOUR) },
      asDb(db),
    );

    const rows = await shiftsInRange(
      centre.id,
      new Date(start.getTime() - HOUR),
      new Date(start.getTime() + 24 * HOUR),
      asDb(db),
    );
    expect(rows[0]!.endedByName).toBe('Anita Raghavan');
  });

  it('closing an already-closed shift reports failure rather than moving the end time', async () => {
    const centre = await makeCentre(db);
    const user = await makeUser(db, centre.id);
    const start = new Date('2026-03-14T18:00:00Z');
    const shift = await clockIn(user.id, centre.id, start, asDb(db));

    const firstEnd = new Date(start.getTime() + 3 * HOUR);
    expect(
      await clockOut({ shiftId: shift.id, centreId: centre.id, byUserId: user.id, at: firstEnd }, asDb(db)),
    ).toBe(true);
    expect(
      await clockOut(
        { shiftId: shift.id, centreId: centre.id, byUserId: user.id, at: new Date(start.getTime() + 9 * HOUR) },
        asDb(db),
      ),
    ).toBe(false);

    const rows = await shiftsInRange(
      centre.id,
      new Date(start.getTime() - HOUR),
      new Date(start.getTime() + 24 * HOUR),
      asDb(db),
    );
    expect(rows[0]!.endedAt!.getTime()).toBe(firstEnd.getTime());
  });

  it('never returns another centre’s shifts, and cannot close one', async () => {
    const a = await makeCentre(db, { name: 'Centre A' });
    const b = await makeCentre(db, { name: 'Centre B' });
    const userA = await makeUser(db, a.id, { name: 'A Person' });
    const userB = await makeUser(db, b.id, { name: 'B Person' });

    const start = new Date('2026-03-15T18:00:00Z');
    await clockIn(userA.id, a.id, start, asDb(db));
    const shiftB = await clockIn(userB.id, b.id, start, asDb(db));

    const from = new Date(start.getTime() - HOUR);
    const to = new Date(start.getTime() + 24 * HOUR);

    const rowsA = await shiftsInRange(a.id, from, to, asDb(db));
    expect(rowsA.map((r) => r.userName)).toEqual(['A Person']);

    // Centre A cannot reach into centre B even holding a valid shift id.
    expect(
      await clockOut({ shiftId: shiftB.id, centreId: a.id, byUserId: userA.id }, asDb(db)),
    ).toBe(false);
    expect(await currentShift(userB.id, asDb(db))).not.toBeNull();
  });

  it('window is on the start time, so a shift outside the range is excluded', async () => {
    const centre = await makeCentre(db);
    const user = await makeUser(db, centre.id);
    const old = new Date('2026-01-05T18:00:00Z');
    const shift = await clockIn(user.id, centre.id, old, asDb(db));
    await clockOut(
      { shiftId: shift.id, centreId: centre.id, byUserId: user.id, at: new Date(old.getTime() + HOUR) },
      asDb(db),
    );

    const rows = await shiftsInRange(
      centre.id,
      new Date('2026-02-01T00:00:00Z'),
      new Date('2026-03-01T00:00:00Z'),
      asDb(db),
    );
    expect(rows).toHaveLength(0);
  });
});
