'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db';
import { complianceAttestation } from '@/db/schema';
import { requireInstructor } from '@/lib/auth/current-user';
import { REQUIREMENTS } from '@/lib/compliance/requirements';
import { optionalText } from '@/lib/validation/form';

const schema = z.object({
  requirementId: z.string().min(1),
  note: optionalText(400),
});

export type AttestState = { error?: string; ok?: boolean };

/**
 * Records the annual certification for a requirement the attendance log cannot
 * prove on its own. Appended, never overwritten — last year's confirmation stays
 * on file, which is the point of an annual certification.
 */
export async function attestAction(_prev: AttestState, formData: FormData): Promise<AttestState> {
  const { user, centre } = await requireInstructor();
  const parsed = schema.safeParse({
    requirementId: formData.get('requirementId'),
    note: formData.get('note'),
  });
  if (!parsed.success) return { error: 'Could not record that confirmation.' };

  const requirement = REQUIREMENTS.find((r) => r.id === parsed.data.requirementId);
  if (!requirement || requirement.kind !== 'attested') {
    return { error: 'That requirement is measured from your records, not confirmed by hand.' };
  }

  await db.insert(complianceAttestation).values({
    centreId: centre.id,
    requirementId: requirement.id,
    confirmedBy: user.id,
    confirmedByName: user.name,
    note: parsed.data.note ?? null,
  });

  revalidatePath('/compliance');
  return { ok: true };
}
