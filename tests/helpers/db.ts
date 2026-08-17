import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import * as schema from '@/db/schema';
import { splitSqlStatements } from '@/db/migrate';
import { hashPassword } from '@/lib/auth/password';
import type { Db } from '@/db/client';

export type TestDb = PgliteDatabase<typeof schema>;

/**
 * A real Postgres per test file, in-process via PGlite. The whole point of these
 * tests is the SQL — the session view, the append-only triggers, the timezone
 * boundaries — so mocking the database would test nothing.
 */
export async function createTestDb(): Promise<{ db: TestDb; cleanup: () => Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), 'centerline-test-'));
  const client = new PGlite(dir);
  const db = drizzle(client, { schema, casing: 'snake_case' });

  await migrate(db, { migrationsFolder: join(process.cwd(), 'db', 'migrations') });
  const views = readFileSync(join(process.cwd(), 'db', 'views.sql'), 'utf8');
  for (const statement of splitSqlStatements(views)) {
    await db.execute(sql.raw(statement));
  }

  return {
    db,
    // Close before deleting the directory. Firing close() without awaiting it left
    // PGlite tearing down a data directory that had already been removed, which
    // surfaced as unhandled rejections that vitest warns can mask real failures.
    cleanup: async () => {
      try {
        await client.close();
      } catch {
        // The instance is being discarded; a failure to close cleanly is not a
        // test result.
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function makeCentre(
  db: TestDb,
  overrides: Partial<typeof schema.centre.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.centre)
    .values({
      name: 'Test Centre',
      timezone: 'America/New_York',
      closeTime: '19:00:00',
      phone: '+13125550000',
      ...overrides,
    })
    .returning();
  return row!;
}

export async function makeUser(
  db: TestDb,
  centreId: string,
  overrides: Partial<typeof schema.user.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.user)
    .values({
      centreId,
      email: `user-${Math.random().toString(36).slice(2)}@test.local`,
      passwordHash: await hashPassword('password123'),
      role: 'instructor',
      name: 'Test Instructor',
      ...overrides,
    })
    .returning();
  return row!;
}

export async function makeStudent(
  db: TestDb,
  centreId: string,
  overrides: Partial<typeof schema.student.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.student)
    .values({
      centreId,
      firstName: 'Test',
      lastInitial: 'S',
      subjects: ['Math'],
      expectedMinutes: 30,
      status: 'active',
      releaseMode: 'guardian_pickup',
      ...overrides,
    })
    .returning();
  return row!;
}

export async function makeGuardian(
  db: TestDb,
  centreId: string,
  studentId: string,
  overrides: Partial<typeof schema.guardian.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.guardian)
    .values({
      centreId,
      name: 'Test Guardian',
      phone: `+1312555${Math.floor(1000 + Math.random() * 8999)}`,
      smsConsent: true,
      smsConsentAt: new Date(),
      ...overrides,
    })
    .returning();
  await db
    .insert(schema.studentGuardian)
    .values({ studentId, guardianId: row!.id, isPrimary: true });
  return row!;
}

export async function addEvent(
  db: TestDb,
  args: {
    centreId: string;
    studentId: string;
    type: 'check_in' | 'check_out';
    occurredAt: Date;
    captureMethod?: schema.CaptureMethod;
    inferenceBasis?: string | null;
    supersedesId?: string | null;
  },
) {
  const [row] = await db
    .insert(schema.attendanceEvent)
    .values({
      centreId: args.centreId,
      studentId: args.studentId,
      type: args.type,
      occurredAt: args.occurredAt,
      captureMethod: args.captureMethod ?? 'kiosk_qr',
      inferenceBasis: args.inferenceBasis ?? null,
      supersedesId: args.supersedesId ?? null,
    })
    .returning();
  return row!;
}

/** The app's Db type and the test type are structurally identical. */
export const asDb = (db: TestDb) => db as unknown as Db;
