import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  asDb,
  createTestDb,
  makeCentre,
  makeGuardian,
  makeStudent,
  type TestDb,
} from './helpers/db';
import { guardian as guardianT, messageLog, studentGuardian } from '@/db/schema';
import { RecordingProvider, setSmsProvider } from '@/lib/sms/provider';
import {
  isQuietHours,
  revokeConsentByPhone,
  sendManualMessage,
  sendNotArrived,
  sendPickupReady,
} from '@/lib/sms/send';
import { pickupReadyBody, stripNonGsm } from '@/lib/sms/templates';
import { instantFromLocal } from '@/lib/time/centre-time';

const TZ = 'America/New_York';
const DAY = '2026-05-12';
const afternoon = instantFromLocal(DAY, { hour: 16, minute: 0 }, TZ);

describe('SMS consent gate', () => {
  let db: TestDb;
  let cleanup: () => Promise<void>;
  let provider: RecordingProvider;

  beforeAll(async () => {
    ({ db, cleanup } = await createTestDb());
  });
  afterAll(() => {
    setSmsProvider(null);
    cleanup();
  });
  afterEach(() => setSmsProvider(null));

  function useRecorder() {
    provider = new RecordingProvider();
    setSmsProvider(provider);
    return provider;
  }

  it('sends to a guardian who has consented', async () => {
    const rec = useRecorder();
    const centre = await makeCentre(db, { timezone: TZ, name: 'Kumon of Somewhere' });
    const student = await makeStudent(db, centre.id, { firstName: 'Aiden' });
    await makeGuardian(db, centre.id, student.id, { smsConsent: true, phone: '+13125550111' });

    const outcome = await sendPickupReady(
      { studentId: student.id, centre, at: afternoon },
      asDb(db),
    );

    expect(outcome.status).toBe('sent');
    expect(rec.sent).toHaveLength(1);
    expect(rec.sent[0]!.to).toBe('+13125550111');
    expect(rec.sent[0]!.body).toBe('Aiden is finished at Kumon of Somewhere and ready for pickup.');
  });

  it('sends NOTHING when the guardian has not consented, and logs the decision', async () => {
    const rec = useRecorder();
    const centre = await makeCentre(db, { timezone: TZ });
    const student = await makeStudent(db, centre.id);
    await makeGuardian(db, centre.id, student.id, { smsConsent: false, smsConsentAt: null });

    const outcome = await sendPickupReady(
      { studentId: student.id, centre, at: afternoon },
      asDb(db),
    );

    expect(outcome.status).toBe('skipped_no_consent');
    expect(rec.sent).toHaveLength(0);

    // The decision is recorded either way, so /compliance can prove the gate works.
    const logged = await db
      .select({ status: messageLog.status })
      .from(messageLog)
      .where(eq(messageLog.studentId, student.id));
    expect(logged).toHaveLength(1);
    expect(logged[0]!.status).toBe('skipped_no_consent');
  });

  it('blocks the not-arrived message too', async () => {
    const rec = useRecorder();
    const centre = await makeCentre(db, { timezone: TZ });
    const student = await makeStudent(db, centre.id);
    await makeGuardian(db, centre.id, student.id, { smsConsent: false, smsConsentAt: null });

    const outcome = await sendNotArrived({ studentId: student.id, centre, at: afternoon }, asDb(db));
    expect(outcome.status).toBe('skipped_no_consent');
    expect(rec.sent).toHaveLength(0);
  });

  it('blocks a manual staff message without consent', async () => {
    const rec = useRecorder();
    const centre = await makeCentre(db, { timezone: TZ });
    const student = await makeStudent(db, centre.id);
    await makeGuardian(db, centre.id, student.id, { smsConsent: false, smsConsentAt: null });

    const outcome = await sendManualMessage(
      { studentId: student.id, centre, body: 'Please call us.', at: afternoon },
      asDb(db),
    );
    expect(outcome.status).toBe('skipped_no_consent');
    expect(rec.sent).toHaveLength(0);
  });

  it('records nothing sendable when no guardian is on file', async () => {
    const rec = useRecorder();
    const centre = await makeCentre(db, { timezone: TZ });
    const student = await makeStudent(db, centre.id);

    const outcome = await sendPickupReady(
      { studentId: student.id, centre, at: afternoon },
      asDb(db),
    );
    expect(outcome.status).toBe('skipped_no_guardian');
    expect(rec.sent).toHaveLength(0);
  });

  it('a STOP reply revokes consent immediately and blocks the next send', async () => {
    const rec = useRecorder();
    const centre = await makeCentre(db, { timezone: TZ });
    const student = await makeStudent(db, centre.id);
    await makeGuardian(db, centre.id, student.id, { smsConsent: true, phone: '+13125550222' });

    const before = await sendPickupReady(
      { studentId: student.id, centre, at: afternoon },
      asDb(db),
    );
    expect(before.status).toBe('sent');

    // Twilio delivers STOP in whatever format the carrier uses; matching is on digits.
    const revoked = await revokeConsentByPhone('(312) 555-0222', asDb(db));
    expect(revoked).toBe(1);

    const after = await sendPickupReady(
      { studentId: student.id, centre, at: new Date(afternoon.getTime() + 60 * 60_000) },
      asDb(db),
    );
    expect(after.status).toBe('skipped_no_consent');
    expect(rec.sent).toHaveLength(1);

    const row = await db
      .select({ consent: guardianT.smsConsent, consentAt: guardianT.smsConsentAt })
      .from(guardianT)
      .where(eq(guardianT.phone, '+13125550222'));
    expect(row[0]!.consent).toBe(false);
    expect(row[0]!.consentAt).toBeNull();
  });

  it('honours quiet hours for proactive messages but not for pickup', async () => {
    const rec = useRecorder();
    const centre = await makeCentre(db, { timezone: TZ });
    const student = await makeStudent(db, centre.id, { firstName: 'Maya' });
    await makeGuardian(db, centre.id, student.id, { smsConsent: true });

    const late = instantFromLocal(DAY, { hour: 21, minute: 30 }, TZ);
    expect(isQuietHours(late, TZ)).toBe(true);
    expect(isQuietHours(afternoon, TZ)).toBe(false);

    // Proactive: suppressed.
    const notArrived = await sendNotArrived({ studentId: student.id, centre, at: late }, asDb(db));
    expect(notArrived.status).toBe('skipped_quiet_hours');

    // Transactional: a guardian waiting in the car park still gets told.
    const pickup = await sendPickupReady({ studentId: student.id, centre, at: late }, asDb(db));
    expect(pickup.status).toBe('sent');
    expect(rec.sent).toHaveLength(1);
  });

  it('sends one message when siblings are checked out close together', async () => {
    const rec = useRecorder();
    const centre = await makeCentre(db, { timezone: TZ });
    const zara = await makeStudent(db, centre.id, { firstName: 'Zara' });
    const kofi = await makeStudent(db, centre.id, { firstName: 'Kofi' });
    const guardian = await makeGuardian(db, centre.id, zara.id, {
      smsConsent: true,
      phone: '+13125559911',
    });
    await db.insert(studentGuardian).values({
      studentId: kofi.id,
      guardianId: guardian.id,
      isPrimary: true,
    });

    const first = await sendPickupReady({ studentId: zara.id, centre, at: afternoon }, asDb(db));
    const second = await sendPickupReady(
      { studentId: kofi.id, centre, at: new Date(afternoon.getTime() + 6 * 60_000) },
      asDb(db),
    );

    expect(first.status).toBe('sent');
    expect(second.status).toBe('suppressed_sibling');
    expect(rec.sent).toHaveLength(1);

    // The suppressed sibling is still recorded, so nothing goes silently missing.
    const logs = await db
      .select({ status: messageLog.status, studentId: messageLog.studentId })
      .from(messageLog)
      .where(eq(messageLog.guardianId, guardian.id));
    expect(logs.map((l) => l.status).sort()).toEqual(['sent', 'suppressed_sibling']);
  });

  it('sends separately when the siblings are far apart', async () => {
    const rec = useRecorder();
    const centre = await makeCentre(db, { timezone: TZ });
    const a = await makeStudent(db, centre.id, { firstName: 'Ada' });
    const b = await makeStudent(db, centre.id, { firstName: 'Ben' });
    const guardian = await makeGuardian(db, centre.id, a.id, { smsConsent: true });
    await db.insert(studentGuardian).values({
      studentId: b.id,
      guardianId: guardian.id,
      isPrimary: true,
    });

    await sendPickupReady({ studentId: a.id, centre, at: afternoon }, asDb(db));
    const second = await sendPickupReady(
      { studentId: b.id, centre, at: new Date(afternoon.getTime() + 12 * 60_000) },
      asDb(db),
    );

    expect(second.status).toBe('sent');
    expect(rec.sent).toHaveLength(2);
  });

  it('logs every message to message_log', async () => {
    useRecorder();
    const centre = await makeCentre(db, { timezone: TZ });
    const student = await makeStudent(db, centre.id);
    await makeGuardian(db, centre.id, student.id, { smsConsent: true });

    await sendPickupReady({ studentId: student.id, centre, at: afternoon }, asDb(db));

    const rows = await db.execute(sql`
      SELECT template, status, body FROM message_log WHERE student_id = ${student.id}
    `);
    const row = rows.rows[0] as { template: string; status: string; body: string };
    expect(row.template).toBe('pickup_ready');
    expect(row.status).toBe('sent');
    expect(row.body.length).toBeGreaterThan(0);
  });

  it('strips emoji so a message stays one billable segment', () => {
    expect(stripNonGsm('Aiden is done 🎉')).toBe('Aiden is done');
    expect(stripNonGsm('Ready — now')).toBe('Ready - now');
    expect(pickupReadyBody(['Aiden'], 'Kumon')).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it('combines names correctly when several children are named', () => {
    expect(pickupReadyBody(['Aiden'], 'Kumon')).toBe('Aiden is finished at Kumon and ready for pickup.');
    expect(pickupReadyBody(['Aiden', 'Maya'], 'Kumon')).toBe(
      'Aiden and Maya are finished at Kumon and ready for pickup.',
    );
  });
});
