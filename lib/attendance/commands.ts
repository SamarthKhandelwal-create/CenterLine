import 'server-only';
import { sql } from 'drizzle-orm';
import { db as defaultDb, type Db } from '@/db';
import { attendanceEvent } from '@/db/schema';
import type { CaptureMethod, EventType } from '@/db/schema';
import { lastEventOnLocalDay } from './queries';

/** A second scan within this window returns the first result instead of flipping. */
export const DOUBLE_SCAN_GRACE_MS = 20_000;

export type ToggleResult = {
  studentId: string;
  action: EventType;
  occurredAt: Date;
  durationMinutes: number | null;
  deduplicated: boolean;
};

/**
 * THE RULE: the student never chooses. An open session today means the scan is a
 * check-out; anything else is a check-in.
 *
 * Wrapped in a transaction that locks the student row first, so two scans landing
 * together cannot both read "no open session" and both insert a check-in. The same
 * lock gives the double-scan grace window its meaning.
 */
export async function toggleAttendance(
  args: {
    studentId: string;
    centreId: string;
    timezone: string;
    captureMethod: CaptureMethod;
    at?: Date;
    createdBy?: string | null;
  },
  db: Db = defaultDb,
): Promise<ToggleResult> {
  const at = args.at ?? new Date();

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM student WHERE id = ${args.studentId} FOR UPDATE`);

    const last = await lastEventOnLocalDay(args.studentId, args.timezone, at, tx as Db);

    if (last && at.getTime() - last.occurredAt.getTime() < DOUBLE_SCAN_GRACE_MS) {
      return {
        studentId: args.studentId,
        action: last.type,
        occurredAt: last.occurredAt,
        durationMinutes: null,
        deduplicated: true,
      };
    }

    const action: EventType = last?.type === 'check_in' ? 'check_out' : 'check_in';

    await tx.insert(attendanceEvent).values({
      centreId: args.centreId,
      studentId: args.studentId,
      type: action,
      occurredAt: at,
      captureMethod: args.captureMethod,
      createdBy: args.createdBy ?? null,
    });

    const durationMinutes =
      action === 'check_out' && last
        ? Math.max(0, Math.round((at.getTime() - last.occurredAt.getTime()) / 60_000))
        : null;

    return { studentId: args.studentId, action, occurredAt: at, durationMinutes, deduplicated: false };
  });
}

/** Records an event directly, for staff actions and the inference cron. */
export async function recordEvent(
  args: {
    studentId: string;
    centreId: string;
    type: EventType;
    occurredAt: Date;
    captureMethod: CaptureMethod;
    inferenceBasis?: string | null;
    confirmedBy?: string | null;
    confirmedAt?: Date | null;
    createdBy?: string | null;
    supersedesId?: string | null;
  },
  db: Db = defaultDb,
): Promise<{ id: string }> {
  const rows = await db
    .insert(attendanceEvent)
    .values({
      centreId: args.centreId,
      studentId: args.studentId,
      type: args.type,
      occurredAt: args.occurredAt,
      captureMethod: args.captureMethod,
      inferenceBasis: args.inferenceBasis ?? null,
      confirmedBy: args.confirmedBy ?? null,
      confirmedAt: args.confirmedAt ?? null,
      createdBy: args.createdBy ?? null,
      supersedesId: args.supersedesId ?? null,
    })
    .returning({ id: attendanceEvent.id });
  return rows[0]!;
}

/**
 * Confirms an inferred check-out. Inserts a NEW 'staff' event superseding the
 * inference — the original inferred row stays in the log forever.
 */
export async function confirmInferredCheckOut(
  args: {
    inferredEventId: string;
    centreId: string;
    studentId: string;
    occurredAt: Date;
    confirmedBy: string;
    at?: Date;
  },
  db: Db = defaultDb,
): Promise<{ id: string }> {
  return recordEvent(
    {
      studentId: args.studentId,
      centreId: args.centreId,
      type: 'check_out',
      occurredAt: args.occurredAt,
      captureMethod: 'staff',
      confirmedBy: args.confirmedBy,
      confirmedAt: args.at ?? new Date(),
      createdBy: args.confirmedBy,
      supersedesId: args.inferredEventId,
    },
    db,
  );
}
