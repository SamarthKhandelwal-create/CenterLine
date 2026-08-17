'use server';

import { writeFile } from 'node:fs/promises';
import { revalidatePath } from 'next/cache';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { credential as credentialT, student as studentT } from '@/db/schema';
import { requireInstructor } from '@/lib/auth/current-user';
import { generateToken, hashToken } from '@/lib/credentials/token';
import { DEMO_CREDENTIALS_PATH } from '@/db/demo-credentials';

export type IssueState = { error?: string; issued?: number };

/**
 * Mints a fresh QR token for every active student and revokes the previous one.
 * Plaintext tokens exist only long enough to render the printable sheet: they are
 * hashed into `credential` and held in the local demo file, never stored in the
 * database in readable form.
 */
export async function issueCardsAction(_prev: IssueState, _formData: FormData): Promise<IssueState> {
  const { centre } = await requireInstructor();

  const students = await db
    .select({ id: studentT.id, firstName: studentT.firstName, lastInitial: studentT.lastInitial })
    .from(studentT)
    .where(and(eq(studentT.centreId, centre.id), eq(studentT.status, 'active')));

  const minted: { id: string; firstName: string; lastInitial: string; token: string }[] = [];

  await db.transaction(async (tx) => {
    for (const s of students) {
      await tx
        .update(credentialT)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(credentialT.studentId, s.id),
            eq(credentialT.kind, 'qr'),
            isNull(credentialT.revokedAt),
          ),
        );
      const token = generateToken();
      await tx.insert(credentialT).values({
        centreId: centre.id,
        studentId: s.id,
        kind: 'qr',
        tokenHash: hashToken(token),
      });
      minted.push({ ...s, token });
    }
  });

  await writeFile(DEMO_CREDENTIALS_PATH, JSON.stringify(minted, null, 2));

  revalidatePath('/students/cards');
  return { issued: minted.length };
}
