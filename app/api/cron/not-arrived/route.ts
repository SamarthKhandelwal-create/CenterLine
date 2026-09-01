import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { absentStudents } from '@/lib/attendance/queries';
import { notArrivedRanToday, sendNotArrived } from '@/lib/sms/send';
import { localHourMinute } from '@/lib/time/centre-time';
import { isAuthorizedCron } from '@/lib/cron-auth';
import { env } from '@/lib/env';
import type { Centre } from '@/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type CentreSummary = {
  centre: string;
  status: 'swept' | 'before_local_hour' | 'already_ran_today';
  notified: number;
  skipped: number;
};

/**
 * Daily, at the first firing on or after the configured centre-local hour.
 *
 * The gate used to be an exact hour match, which only worked because the cron ran
 * hourly. Vercel Hobby allows one run a day and only guarantees it fires *within* the
 * scheduled hour, so an equality test would drop the entire feature silently — on a
 * DST shift, or on any run that drifted an hour. The gate is now "at or past the local
 * hour", and `notArrivedRanToday` is what holds it to once per centre per day. That
 * pairing is also correct at hourly frequency, so upgrading to Pro needs no code change.
 *
 * 22:00 UTC is 17:00/18:00 for a US-Eastern centre: past the default NOT_ARRIVED_HOUR
 * in either DST state, and still clear of the 21:00 quiet-hours cutoff. One daily
 * trigger cannot be timely in every timezone at once — a centre far enough west that
 * 22:00 UTC is still before its local hour is reported as `before_local_hour` rather
 * than being dropped without trace. See README on retuning the schedule.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const at = new Date();
  const centres = (await db.execute(sql`SELECT * FROM centre`)).rows as unknown as Centre[];
  const summary: CentreSummary[] = [];

  for (const centre of centres) {
    const { hour } = localHourMinute(at, centre.timezone);
    if (hour < env.NOT_ARRIVED_HOUR) {
      summary.push({ centre: centre.name, status: 'before_local_hour', notified: 0, skipped: 0 });
      continue;
    }
    if (await notArrivedRanToday(centre, at)) {
      summary.push({ centre: centre.name, status: 'already_ran_today', notified: 0, skipped: 0 });
      continue;
    }

    const absent = await absentStudents(centre.id, centre.timezone, at);
    let notified = 0;
    let skipped = 0;
    for (const student of absent) {
      const outcome = await sendNotArrived({ studentId: student.studentId, centre, at });
      if (outcome.status === 'sent') notified += 1;
      else skipped += 1;
    }
    summary.push({ centre: centre.name, status: 'swept', notified, skipped });
  }

  return NextResponse.json({ ok: true, summary });
}
