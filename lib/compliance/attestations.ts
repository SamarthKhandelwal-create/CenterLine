import 'server-only';
import { desc, eq } from 'drizzle-orm';
import { db as defaultDb, type Db } from '@/db';
import { complianceAttestation } from '@/db/schema';
import type { Attestation } from './requirements';

/** The most recent confirmation for each requirement at this centre. */
export async function currentAttestations(
  centreId: string,
  db: Db = defaultDb,
): Promise<Attestation[]> {
  const rows = await db
    .select({
      requirementId: complianceAttestation.requirementId,
      confirmedByName: complianceAttestation.confirmedByName,
      confirmedAt: complianceAttestation.confirmedAt,
    })
    .from(complianceAttestation)
    .where(eq(complianceAttestation.centreId, centreId))
    .orderBy(desc(complianceAttestation.confirmedAt));

  const latest = new Map<string, Attestation>();
  for (const row of rows) {
    if (!latest.has(row.requirementId)) latest.set(row.requirementId, row);
  }
  return [...latest.values()];
}
