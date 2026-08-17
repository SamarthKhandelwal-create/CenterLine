import { and, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { guardian as guardianT, student as studentT, studentGuardian } from '@/db/schema';
import { requireInstructor } from '@/lib/auth/current-user';
import { toCsv } from '@/lib/csv';
import { localDateString } from '@/lib/time/centre-time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Requirement 6: a copy of the data the centre can keep outside this system.
 *
 * Two CSV documents in one download — the roster and every attendance record — so a
 * centre can answer "who was here and when" from a spreadsheet if this system is
 * unavailable.
 */
export async function GET() {
  const { centre } = await requireInstructor();
  const today = localDateString(new Date(), centre.timezone);

  const students = await db
    .select({
      id: studentT.id,
      firstName: studentT.firstName,
      lastInitial: studentT.lastInitial,
      subjects: studentT.subjects,
      expectedMinutes: studentT.expectedMinutes,
      status: studentT.status,
      releaseMode: studentT.releaseMode,
      guardianName: guardianT.name,
      guardianPhone: guardianT.phone,
      smsConsent: guardianT.smsConsent,
    })
    .from(studentT)
    .leftJoin(
      studentGuardian,
      and(eq(studentGuardian.studentId, studentT.id), eq(studentGuardian.isPrimary, true)),
    )
    .leftJoin(guardianT, eq(guardianT.id, studentGuardian.guardianId))
    .where(eq(studentT.centreId, centre.id))
    .orderBy(studentT.firstName, studentT.lastInitial);

  const events = await db.execute(sql`
    SELECT
      (e.occurred_at AT TIME ZONE ${centre.timezone})::date::text AS local_date,
      to_char(e.occurred_at AT TIME ZONE ${centre.timezone}, 'HH24:MI')  AS local_time,
      s.first_name, s.last_initial, e.type, e.capture_method,
      COALESCE(e.inference_basis, '') AS basis,
      CASE WHEN e.supersedes_id IS NOT NULL THEN 'correction' ELSE '' END AS correction,
      CASE WHEN EXISTS (SELECT 1 FROM attendance_event x WHERE x.supersedes_id = e.id)
           THEN 'superseded' ELSE 'current' END AS record_state
    FROM attendance_event e
    JOIN student s ON s.id = e.student_id
    WHERE e.centre_id = ${centre.id}
    ORDER BY e.occurred_at
  `);

  const rosterCsv = toCsv([
    ['ROSTER', `${centre.name}`, `exported ${today}`],
    ['First name', 'Last initial', 'Subjects', 'Expected minutes', 'Status', 'Release', 'Guardian', 'Phone', 'SMS consent'],
    ...students.map((s) => [
      s.firstName,
      s.lastInitial,
      (s.subjects ?? []).join(' / '),
      s.expectedMinutes,
      s.status,
      s.releaseMode,
      s.guardianName ?? '',
      s.guardianPhone ?? '',
      s.smsConsent ? 'yes' : 'no',
    ]),
  ]);

  const eventRows = events.rows as Record<string, string>[];
  const eventsCsv = toCsv([
    ['ATTENDANCE RECORDS', `${centre.name}`, `exported ${today}`, 'append-only log, including superseded entries'],
    ['Date', 'Time', 'First name', 'Last initial', 'Event', 'Captured by', 'Basis', 'Correction', 'Record state'],
    ...eventRows.map((r) => [
      r.local_date,
      r.local_time,
      r.first_name,
      r.last_initial,
      r.type === 'check_in' ? 'check in' : 'check out',
      r.capture_method === 'inferred' ? 'ESTIMATED - not observed' : r.capture_method,
      r.basis,
      r.correction,
      r.record_state,
    ]),
  ]);

  const body = `﻿${rosterCsv}\r\n\r\n\r\n${eventsCsv}\r\n`;
  const slug = centre.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();

  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="centerline-backup-${slug}-${today}.csv"`,
    },
  });
}
