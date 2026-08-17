import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db as defaultDb, type Db } from '@/db';
import {
  credential as credentialT,
  guardian as guardianT,
  student as studentT,
  studentGuardian,
  studentImportKey,
} from '@/db/schema';
import { generateToken, hashToken } from '@/lib/credentials/token';
import { expectedMinutesFor } from '@/lib/students/expected-minutes';
import { fullNameKey, normalizePhone } from './normalize';
import type { ImportItem, ImportPlan } from './analyze';

export type CommitResult = {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
};

/**
 * Applies the plan in ONE transaction.
 *
 * Idempotency guarantee: given the same file and no intervening roster edits, this
 * performs zero inserts and zero updates on the second run. That holds because
 *   (i)  matching is by recorded import key, not by fuzzy name lookup,
 *   (ii) comparison is canonical (sorted subjects, E.164 phones, trimmed names),
 *   (iii) rows whose action is 'unchanged' are never written at all.
 *
 * Import NEVER touches attendance_event, and never deactivates a student merely for
 * being absent from the file — a partial export must not wipe the roster.
 */
export async function commitImport(
  args: {
    centreId: string;
    plan: ImportPlan;
    /** Ambiguous rows the instructor resolved: item index -> student id, or 'new'. */
    resolutions?: Record<number, string>;
    /** Rows the instructor unticked in the review screen. */
    excluded?: number[];
  },
  db: Db = defaultDb,
): Promise<CommitResult> {
  const excluded = new Set(args.excluded ?? []);
  const resolutions = args.resolutions ?? {};
  const result: CommitResult = { created: 0, updated: 0, unchanged: 0, skipped: 0 };

  await db.transaction(async (tx) => {
    for (const [index, item] of args.plan.items.entries()) {
      if (excluded.has(index)) {
        result.skipped += 1;
        continue;
      }

      let action = item.action;
      let matchedId = item.matchedStudentId;

      if (action === 'ambiguous') {
        const choice = resolutions[index];
        if (!choice) {
          result.skipped += 1;
          continue;
        }
        if (choice === 'new') {
          action = 'new';
          matchedId = null;
        } else {
          action = 'updated';
          matchedId = choice;
        }
      }

      if (action === 'unchanged') {
        // Still record the keys, so a first import that matched on name alone can
        // match on a recorded key next time.
        await writeKeys(tx, args.centreId, item, matchedId);
        result.unchanged += 1;
        continue;
      }

      if (action === 'new') {
        const subjects = item.candidate.subjects.length > 0 ? item.candidate.subjects : ['Math'];
        const [created] = await tx
          .insert(studentT)
          .values({
            centreId: args.centreId,
            firstName: item.candidate.firstName,
            lastInitial: item.candidate.lastInitial,
            subjects,
            expectedMinutes: item.candidate.expectedMinutes ?? expectedMinutesFor(subjects),
            status: item.candidate.status,
            releaseMode: item.candidate.releaseMode ?? 'guardian_pickup',
          })
          .returning({ id: studentT.id });

        const studentId = created!.id;
        // A new student needs a working card immediately, or they cannot use the
        // kiosk on the day they are imported.
        await tx.insert(credentialT).values({
          centreId: args.centreId,
          studentId,
          kind: 'qr',
          tokenHash: hashToken(generateToken()),
        });

        await upsertGuardian(tx, args.centreId, studentId, item);
        await writeKeys(tx, args.centreId, item, studentId);
        result.created += 1;
        continue;
      }

      if (matchedId) {
        const subjects = item.candidate.subjects;
        // The allowance follows the subject count unless the file states it outright.
        // Writing it only when the file carried a minutes column meant a student who
        // picked up a second subject on a re-import got the new subject and kept the
        // old 30-minute allowance for ever — their floor timer then went amber halfway
        // through a session they were entitled to be in.
        //
        // `resolvedExpectedMinutes` comes from analyze, which had the stored student in
        // hand; it is the figure shown in the review screen, so what is approved is
        // what is written. Absent for a row the instructor resolved from 'ambiguous',
        // where the fallback derives it from the subjects being written.
        const expectedMinutes =
          item.resolvedExpectedMinutes ??
          item.candidate.expectedMinutes ??
          (subjects.length > 0 ? expectedMinutesFor(subjects) : null);
        await tx
          .update(studentT)
          .set({
            firstName: item.candidate.firstName,
            lastInitial: item.candidate.lastInitial,
            ...(subjects.length > 0 ? { subjects } : {}),
            ...(expectedMinutes !== null ? { expectedMinutes } : {}),
            status: item.candidate.status,
            ...(item.candidate.releaseMode ? { releaseMode: item.candidate.releaseMode } : {}),
          })
          .where(and(eq(studentT.id, matchedId), eq(studentT.centreId, args.centreId)));

        await upsertGuardian(tx, args.centreId, matchedId, item);
        await writeKeys(tx, args.centreId, item, matchedId);
        result.updated += 1;
      }
    }
  });

  return result;
}

/** Records the identity keys so the next import of this file matches exactly. */
async function writeKeys(tx: Db, centreId: string, item: ImportItem, studentId: string | null) {
  if (!studentId) return;
  const rows: { centreId: string; studentId: string; keyKind: string; keyValue: string }[] = [];
  if (item.candidate.sourceId) {
    rows.push({ centreId, studentId, keyKind: 'source_id', keyValue: item.candidate.sourceId });
  }
  const nameKey = fullNameKey(item.candidate.firstName, item.candidate.lastName);
  if (nameKey !== '|') {
    rows.push({ centreId, studentId, keyKind: 'full_name', keyValue: nameKey });
  }
  for (const row of rows) {
    await tx.insert(studentImportKey).values(row).onConflictDoNothing();
  }
}

async function upsertGuardian(tx: Db, centreId: string, studentId: string, item: ImportItem) {
  const { guardianName, guardianPhone } = item.candidate;
  if (!guardianName && !guardianPhone) return;

  const existing = await tx
    .select({ guardianId: guardianT.id, name: guardianT.name, phone: guardianT.phone })
    .from(studentGuardian)
    .innerJoin(guardianT, eq(guardianT.id, studentGuardian.guardianId))
    .where(and(eq(studentGuardian.studentId, studentId), eq(studentGuardian.isPrimary, true)))
    .limit(1);

  const current = existing[0];
  if (current) {
    const nameChanged = guardianName && current.name !== guardianName;
    const phoneChanged = guardianPhone && normalizePhone(current.phone) !== guardianPhone;
    if (!nameChanged && !phoneChanged) return;
    await tx
      .update(guardianT)
      .set({
        ...(guardianName ? { name: guardianName } : {}),
        ...(guardianPhone ? { phone: guardianPhone } : {}),
      })
      .where(eq(guardianT.id, current.guardianId));
    return;
  }

  // Consent is NEVER granted by an import. A phone number in a spreadsheet is not
  // permission to text it — the instructor ticks the box on the student page.
  const [created] = await tx
    .insert(guardianT)
    .values({
      centreId,
      name: guardianName ?? 'Guardian',
      phone: guardianPhone ?? '',
      smsConsent: false,
      smsConsentAt: null,
    })
    .returning({ id: guardianT.id });

  await tx
    .insert(studentGuardian)
    .values({ studentId, guardianId: created!.id, isPrimary: true })
    .onConflictDoNothing();
}
