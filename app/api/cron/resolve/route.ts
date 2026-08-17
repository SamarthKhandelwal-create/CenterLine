import { NextResponse } from 'next/server';
import { resolveOpenSessions } from '@/lib/attendance/resolve';
import { isAuthorizedCron } from '@/lib/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Hourly. Closes sessions left open past close_time + 60 minutes. */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const results = await resolveOpenSessions();
  const inserted = results.reduce((sum, r) => sum + r.inserted, 0);
  return NextResponse.json({ ok: true, inserted, centres: results });
}
