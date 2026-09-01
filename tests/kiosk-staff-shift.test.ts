import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toggleStaffShift } from '@/lib/kiosk/staff';
import { clockIn, currentShift, staffShiftStatus, shiftsInRange } from '@/lib/staff/shifts';
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

describe('kiosk staff clock in / out', () => {
  it('one tap starts the shift, the next tap ends it', async () => {
    const centre = await makeCentre(db);
    const person = await makeUser(db, centre.id, { name: 'Marcus Bell', role: 'assistant' });

    const start = new Date('2026-04-01T18:00:00Z');
    const inResult = await toggleStaffShift(
      { centre, userId: person.id, at: start },
      asDb(db),
    );
    expect(inResult).toMatchObject({ ok: true, action: 'clock_in', name: 'Marcus Bell' });
    expect(await currentShift(person.id, asDb(db))).not.toBeNull();

    const outResult = await toggleStaffShift(
      { centre, userId: person.id, at: new Date(start.getTime() + 4 * HOUR) },
      asDb(db),
    );
    expect(outResult).toMatchObject({ ok: true, action: 'clock_out', durationMinutes: 240 });
    expect(await currentShift(person.id, asDb(db))).toBeNull();
  });

  it('records the person as having closed their own shift', async () => {
    const centre = await makeCentre(db);
    const person = await makeUser(db, centre.id, { name: 'Hana Sato', role: 'assistant' });

    const start = new Date('2026-04-02T18:00:00Z');
    await toggleStaffShift({ centre, userId: person.id, at: start }, asDb(db));
    await toggleStaffShift(
      { centre, userId: person.id, at: new Date(start.getTime() + HOUR) },
      asDb(db),
    );

    const rows = await shiftsInRange(
      centre.id,
      new Date(start.getTime() - HOUR),
      new Date(start.getTime() + 24 * HOUR),
      asDb(db),
    );
    // Not "closed by somebody else": the tablet is unauthenticated, but the tap is the
    // person's own, and /staff must not imply an instructor stepped in.
    expect(rows[0]!.endedByName).toBe('Hana Sato');
  });

  it('refuses a person from another centre without saying why', async () => {
    const a = await makeCentre(db, { name: 'Centre A' });
    const b = await makeCentre(db, { name: 'Centre B' });
    const theirs = await makeUser(db, b.id, { name: 'B Person' });

    // The kiosk device cookie authorises the tablet, not the id it happens to send.
    const result = await toggleStaffShift({ centre: a, userId: theirs.id }, asDb(db));
    expect(result).toEqual({ ok: false });
    expect(await currentShift(theirs.id, asDb(db))).toBeNull();
  });

  it('lists every member of staff with their open shift, and nobody else’s', async () => {
    const centre = await makeCentre(db, { name: 'Listing Centre' });
    const other = await makeCentre(db, { name: 'Other Centre' });
    const onShift = await makeUser(db, centre.id, { name: 'Anita Raghavan' });
    await makeUser(db, centre.id, { name: 'Elias Berg', role: 'assistant' });
    await makeUser(db, other.id, { name: 'Nobody Here' });

    const start = new Date('2026-04-03T18:00:00Z');
    await clockIn(onShift.id, centre.id, start, asDb(db));

    const status = await staffShiftStatus(centre.id, asDb(db));
    expect(status.map((s) => s.name)).toEqual(['Anita Raghavan', 'Elias Berg']);
    expect(status[0]!.startedAt?.getTime()).toBe(start.getTime());
    expect(status[1]!.startedAt).toBeNull();
  });

  it('a closed shift leaves exactly one row, however many taps it took', async () => {
    const centre = await makeCentre(db);
    const person = await makeUser(db, centre.id, { name: 'Grace Okonkwo', role: 'assistant' });

    const start = new Date('2026-04-04T18:00:00Z');
    // The double-tap at the door: two people press it, or one person presses twice.
    await toggleStaffShift({ centre, userId: person.id, at: start }, asDb(db));
    const second = await toggleStaffShift(
      { centre, userId: person.id, at: new Date(start.getTime() + 60_000) },
      asDb(db),
    );
    expect(second).toMatchObject({ ok: true, action: 'clock_out' });

    const rows = await shiftsInRange(
      centre.id,
      new Date(start.getTime() - HOUR),
      new Date(start.getTime() + 24 * HOUR),
      asDb(db),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.durationMinutes).toBe(1);
  });
});
