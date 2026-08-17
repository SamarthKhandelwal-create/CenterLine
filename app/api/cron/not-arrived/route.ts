import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { absentStudents } from '@/lib/attendance/queries';
import { sendNotArrived } from '@/lib/sms/send';
import { localHourMinute } from '@/lib/time/centre-time';
import { isAuthorizedCron } from '@/lib/cron-auth';
import { env } from '@/lib/env';
import type { Centre } from '@/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Runs hourly and acts only in the configured centre-local hour, so one cron
 * schedule serves centres in different timezones.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const at = new Date();
  const centres = (await db.execute(sql`SELECT * FROM centre`)).rows as unknown as Centre[];
  const summary: { centre: string; notified: number; skipped: number }[] = [];

  for (const centre of centres) {
    const { hour } = localHourMinute(at, centre.timezone);
    if (hour !== env.NOT_ARRIVED_HOUR) continue;

    const absent = await absentStudents(centre.id, centre.timezone, at);
    let notified = 0;
    let skipped = 0;
    for (const student of absent) {
      const outcome = await sendNotArrived({ studentId: student.studentId, centre, at });
      if (outcome.status === 'sent') notified += 1;
      else skipped += 1;
    }
    summary.push({ centre: centre.name, notified, skipped });
  }

  return NextResponse.json({ ok: true, summary });
}
