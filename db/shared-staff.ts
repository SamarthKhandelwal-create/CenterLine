import { eq, sql } from 'drizzle-orm';
import { centre as centreT, user as userT } from './schema';
import { hashPassword } from '../lib/auth/password';
import type { Db } from './client';

/**
 * Working accounts rather than demo characters: each has a password of its own instead
 * of SEED_PASSWORD, because real people type these.
 *
 * Deliberately outside the demo shift rota in db/seed.ts. Those shifts are drawn from a
 * seeded PRNG, so adding a person to that loop would move every draw after it and a
 * reseed would stop reproducing the same data.
 *
 * Its own module, not part of seed.ts, so `scripts/add-shared-staff.ts` can apply it to
 * a live database without importing — and therefore running — the seed.
 *
 * Passwords come from the environment: these are live credentials real staff sign in
 * with, and this file is in version control. Set them in .env.local (gitignored):
 *
 *   LIBERTY_STAFF_PASSWORD=...
 *   MASON_INSTRUCTOR_PASSWORD=...
 *   MASON_STAFF_PASSWORD=...
 *
 * `requirePassword` throws rather than defaulting, so a missing variable fails loudly
 * at the point of use instead of quietly setting an account to a guessable password.
 */
function requirePassword(envVar: string): string {
  const value = process.env[envVar];
  if (!value) {
    throw new Error(
      `${envVar} is not set. Shared staff passwords are read from the environment; ` +
        `add it to .env.local before running this.`,
    );
  }
  return value;
}

export const SHARED_STAFF = [
  {
    centreName: 'Kumon of Liberty Township',
    email: 'staff@kumonofliberty',
    name: 'Liberty Staff',
    passwordEnvVar: 'LIBERTY_STAFF_PASSWORD',
    /**
     * Assistant, not instructor: this is the account used at the front desk, and an
     * assistant reaches /floor, /emergency and the kiosk but not the roster, the day
     * close-out or anybody's hours.
     */
    role: 'assistant' as const,
  },
  {
    centreName: 'Kumon of Mason West',
    email: 'instructor@kumonofmason',
    name: 'Mason Instructor',
    passwordEnvVar: 'MASON_INSTRUCTOR_PASSWORD',
    role: 'instructor' as const,
  },
  {
    centreName: 'Kumon of Mason West',
    email: 'staff@kumonofmason',
    name: 'Mason Staff',
    passwordEnvVar: 'MASON_STAFF_PASSWORD',
    role: 'assistant' as const,
  },
];

/**
 * Creates the accounts above, or re-points the password of one that already exists.
 *
 * Idempotent on email — matched case-insensitively, the same way sign-in matches it —
 * so running it twice changes nothing the second time.
 */
export async function createSharedStaff(db: Db): Promise<string[]> {
  const results: string[] = [];

  for (const person of SHARED_STAFF) {
    const centres = await db
      .select({ id: centreT.id })
      .from(centreT)
      .where(eq(centreT.name, person.centreName))
      .limit(1);

    const centreId = centres[0]?.id;
    if (!centreId) {
      results.push(`${person.email} — SKIPPED, no centre named "${person.centreName}"`);
      continue;
    }

    const passwordHash = await hashPassword(requirePassword(person.passwordEnvVar));
    const existing = await db
      .select({ id: userT.id })
      .from(userT)
      .where(sql`lower(${userT.email}) = ${person.email.toLowerCase()}`)
      .limit(1);

    if (existing[0]) {
      await db
        .update(userT)
        .set({ passwordHash, name: person.name, role: person.role, centreId })
        .where(eq(userT.id, existing[0].id));
      results.push(`${person.email} — updated (password reset, ${person.role} at ${person.centreName})`);
    } else {
      await db.insert(userT).values({
        centreId,
        email: person.email,
        passwordHash,
        role: person.role,
        name: person.name,
      });
      results.push(`${person.email} — created (${person.role} at ${person.centreName})`);
    }
  }

  return results;
}
