'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNull } from 'drizzle-orm';
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
