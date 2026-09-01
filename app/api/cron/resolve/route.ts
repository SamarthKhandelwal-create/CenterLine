import { NextResponse } from 'next/server';
import { resolveRecentOpenSessions } from '@/lib/attendance/resolve';
import { isAuthorizedCron } from '@/lib/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Nightly. Closes sessions left open past close_time + 60 minutes.
 *
 * Scheduled at 02:00 UTC, which is late evening for a US-Eastern centre in either DST
 * state: past close + 60, and still the same local day. It sweeps the previous local
 * day too, so the exact firing instant is not load-bearing.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const results = await resolveRecentOpenSessions();
  const inserted = results.reduce((sum, r) => sum + r.inserted, 0);
  return NextResponse.json({ ok: true, inserted, centres: results });
}
