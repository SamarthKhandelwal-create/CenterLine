'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import {
  credential as credentialT,
  guardian as guardianT,
  student as studentT,
  studentGuardian,
} from '@/db/schema';
import { requireInstructor } from '@/lib/auth/current-user';
import { generateToken, hashToken } from '@/lib/credentials/token';
import { expectedMinutesFor } from '@/lib/students/expected-minutes';
import { checkbox, firstIssue, optionalText, requiredText, textList } from '@/lib/validation/form';

const studentSchema = z.object({
  firstName: requiredText('Enter a first name', 80),
  lastInitial: requiredText('Enter a last initial', 4),
  subjects: textList(),
  expectedMinutes: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : undefined),
    z.number().int().min(5).max(480).optional(),
  ),
  status: z.enum(['active', 'inactive']).default('active'),
  releaseMode: z.enum(['guardian_pickup', 'self_release']).default('guardian_pickup'),
  guardianName: optionalText(120),
  guardianPhone: optionalText(40),
  smsConsent: checkbox(),
});

export type StudentFormState = { error?: string; ok?: boolean };

function readForm(formData: FormData) {
  return {
    firstName: formData.get('firstName'),
    lastInitial: formData.get('lastInitial'),
    subjects: formData.get('subjects'),
    expectedMinutes: formData.get('expectedMinutes'),
    status: formData.get('status') ?? 'active',
    releaseMode: formData.get('releaseMode') ?? 'guardian_pickup',
    guardianName: formData.get('guardianName'),
    guardianPhone: formData.get('guardianPhone'),
    smsConsent: formData.get('smsConsent'),
  };
}

export async function createStudentAction(
  _prev: StudentFormState,
  formData: FormData,
): Promise<StudentFormState> {
  const { centre } = await requireInstructor();
  const parsed = studentSchema.safeParse(readForm(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const v = parsed.data;

  const subjects = v.subjects.length > 0 ? v.subjects : ['Math'];
  const [created] = await db
    .insert(studentT)
    .values({
      centreId: centre.id,
      firstName: v.firstName,
      lastInitial: v.lastInitial.slice(0, 1).toUpperCase(),
      subjects,
      // "30 per subject" is the documented default when nothing is supplied.
      expectedMinutes: v.expectedMinutes ?? expectedMinutesFor(subjects),
      status: v.status,
      releaseMode: v.releaseMode,
    })
    .returning();

  // Every student gets a QR token at creation, so a card can be printed immediately
  // and the kiosk works for them on day one.
  await issueCredentials(created!.id, centre.id);
  await upsertGuardian(created!.id, centre.id, v);

  revalidatePath('/students');
  return { ok: true };
}

export async function updateStudentAction(
  _prev: StudentFormState,
  formData: FormData,
): Promise<StudentFormState> {
  const { centre } = await requireInstructor();
  const id = z.string().uuid().safeParse(formData.get('studentId'));
  if (!id.success) return { error: 'Invalid student.' };
  const parsed = studentSchema.safeParse(readForm(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const v = parsed.data;

  const subjects = v.subjects.length > 0 ? v.subjects : ['Math'];
  await db
    .update(studentT)
    .set({
      firstName: v.firstName,
      lastInitial: v.lastInitial.slice(0, 1).toUpperCase(),
      subjects,
      expectedMinutes: v.expectedMinutes ?? expectedMinutesFor(subjects),
      status: v.status,
      releaseMode: v.releaseMode,
    })
    .where(and(eq(studentT.id, id.data), eq(studentT.centreId, centre.id)));

  await upsertGuardian(id.data, centre.id, v);
  revalidatePath('/students');
  revalidatePath(`/students/${id.data}`);
  return { ok: true };
}

async function issueCredentials(studentId: string, centreId: string) {
  const token = generateToken();
  await db.insert(credentialT).values({
    centreId,
    studentId,
    kind: 'qr',
    tokenHash: hashToken(token),
  });
  return { token };
}

async function upsertGuardian(
  studentId: string,
  centreId: string,
  v: z.infer<typeof studentSchema>,
) {
  if (!v.guardianName || !v.guardianPhone) return;

  const existing = await db
    .select({ guardianId: guardianT.id })
    .from(studentGuardian)
    .innerJoin(guardianT, eq(guardianT.id, studentGuardian.guardianId))
    .where(eq(studentGuardian.studentId, studentId))
    .limit(1);

  // Consent is captured at the moment the instructor ticks the box, with a timestamp.
  const consentAt = v.smsConsent ? new Date() : null;

  if (existing[0]) {
    await db
      .update(guardianT)
      .set({
        name: v.guardianName,
        phone: v.guardianPhone,
        smsConsent: v.smsConsent,
        smsConsentAt: consentAt,
      })
      .where(eq(guardianT.id, existing[0].guardianId));
    return;
  }

  const [g] = await db
    .insert(guardianT)
    .values({
      centreId,
      name: v.guardianName,
      phone: v.guardianPhone,
      smsConsent: v.smsConsent,
      smsConsentAt: consentAt,
    })
    .returning();
  await db.insert(studentGuardian).values({ studentId, guardianId: g!.id, isPrimary: true });
}

export type RemoveStudentState = {
  error?: string;
  ok?: boolean;
  /** Which of the two things actually happened, so the UI can say so plainly. */
  mode?: 'deleted' | 'deactivated';
  eventCount?: number;
};

/**
 * Removes a student, in the only two senses the compliance model allows.
 *
 * A student who has ever been checked in CANNOT be deleted, and this is enforced two
 * levels down rather than by this function's good manners: `attendance_event.student_id`
 * cascades on delete, and `db/views.sql` puts a BEFORE DELETE trigger on that table
 * which raises. So a hard delete of a student with history aborts the transaction. That
 * is the correct outcome — the attendance log is the evidence the centre is inspected
 * on, and a child leaving must not erase the record that they were ever here.
 *
 * So: history means deactivate, which is what "removed from the roster" means in
 * practice. They leave the floor, the kiosk and the active roster, and their record
 * stays. No history means the row was a mistake — a bad import line, a typo — and it
 * is genuinely deleted, along with its credentials, guardian links and import keys.
 */
export async function removeStudentAction(formData: FormData): Promise<RemoveStudentState> {
  const { centre } = await requireInstructor();
  const id = z.string().uuid().safeParse(formData.get('studentId'));
  if (!id.success) return { error: 'Invalid student.' };

  // Scoped to the centre, so a forged id cannot reach another centre's roster.
  const owned = await db
    .select({ id: studentT.id })
    .from(studentT)
    .where(and(eq(studentT.id, id.data), eq(studentT.centreId, centre.id)))
    .limit(1);
  if (!owned[0]) return { error: 'That student is not in this centre.' };

  // Every event, not just the live ones: a superseded or voided row is still a record
  // that this child was here, and deleting the student would take it with them.
  const counted = await db.execute(sql`
    SELECT count(*)::int AS n FROM attendance_event WHERE student_id = ${id.data}
  `);
  const eventCount = (counted.rows[0] as { n: number }).n;

  if (eventCount > 0) {
    await db
      .update(studentT)
      .set({ status: 'inactive' })
      .where(and(eq(studentT.id, id.data), eq(studentT.centreId, centre.id)));
    revalidatePath('/students');
    revalidatePath('/floor');
    return { ok: true, mode: 'deactivated', eventCount };
  }

  await db.transaction(async (tx) => {
    // credential, student_guardian and student_import_key all cascade from student.
    await tx
      .delete(studentT)
      .where(and(eq(studentT.id, id.data), eq(studentT.centreId, centre.id)));

    // A guardian exists only to be somebody's contact. Once their last child is gone
    // the row is a stranded phone number, so it goes too — deliberately after the
    // delete, and only when nothing else points at them (siblings keep theirs).
    await tx.execute(sql`
      DELETE FROM guardian g
      WHERE g.centre_id = ${centre.id}
        AND NOT EXISTS (SELECT 1 FROM student_guardian sg WHERE sg.guardian_id = g.id)
    `);
  });

  revalidatePath('/students');
  revalidatePath('/floor');
  return { ok: true, mode: 'deleted', eventCount: 0 };
}

/** Revokes the old QR credential and issues a new one, for a lost card. */
export async function reissueCardAction(formData: FormData) {
  const { centre } = await requireInstructor();
  const id = z.string().uuid().safeParse(formData.get('studentId'));
  if (!id.success) return { error: 'Invalid student.' };

  await db
    .update(credentialT)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(credentialT.studentId, id.data),
        eq(credentialT.centreId, centre.id),
        eq(credentialT.kind, 'qr'),
        isNull(credentialT.revokedAt),
      ),
    );

  const token = generateToken();
  await db.insert(credentialT).values({
    centreId: centre.id,
    studentId: id.data,
    kind: 'qr',
    tokenHash: hashToken(token),
  });

  revalidatePath('/students');
  return { ok: true, token };
}
