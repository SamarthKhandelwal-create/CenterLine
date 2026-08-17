import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { requireInstructor } from '@/lib/auth/current-user';
import {
  captureStatistics,
  evaluateRequirements,
  RETENTION_POLICY,
  SYSTEM_DESCRIPTION,
} from '@/lib/compliance/requirements';
import { currentAttestations } from '@/lib/compliance/attestations';
import { sessionsInRange } from '@/lib/attendance/queries';
import { addDays, formatLocalDate, formatLocalTime, localDateString } from '@/lib/time/centre-time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const { centre, user } = await requireInstructor();
  const url = new URL(request.url);
  const today = localDateString(new Date(), centre.timezone);
  const from = url.searchParams.get('from') || addDays(today, -30);
  const to = url.searchParams.get('to') || today;

  const attestations = await currentAttestations(centre.id);
  const ctx = { centre, from, to, attestations };
  const [requirements, stats, sessions] = await Promise.all([
    evaluateRequirements(ctx),
    captureStatistics(ctx),
    sessionsInRange(centre.id, from, to),
  ]);

  const corrections = (
    await db.execute(sql`
      SELECT count(*)::int n FROM attendance_event
      WHERE centre_id = ${centre.id} AND supersedes_id IS NOT NULL
    `)
  ).rows[0] as { n: number };

  // A representative sample: every estimated session (they matter most to an
  // auditor), then ordinary ones, up to 40 rows.
  const estimated = sessions.filter((s) => s.isEstimated);
  const ordinary = sessions.filter((s) => !s.isEstimated);
  const sample = [...estimated.slice(0, 15), ...ordinary.slice(0, 25)]
    .sort((a, b) => b.checkInAt.getTime() - a.checkInAt.getTime())
    .map((s) => ({
      date: s.sessionDate,
      student: `${s.firstName} ${s.lastInitial}.`,
      checkIn: formatLocalTime(s.checkInAt, centre.timezone),
      checkOut: s.checkOutAt ? formatLocalTime(s.checkOutAt, centre.timezone) : 'still present',
      method: s.checkOutMethod ?? s.checkInMethod,
      estimated: s.isEstimated,
      basis: s.checkOutBasis,
    }));

  const { renderToBuffer } = await import('@react-pdf/renderer');
  const { EvidencePack } = await import('@/lib/pdf/evidence-pack');

  const buffer = await renderToBuffer(
    EvidencePack({
      centreName: centre.name,
      timezone: centre.timezone,
      from,
      to,
      generatedAt: `${formatLocalDate(new Date(), centre.timezone)} at ${formatLocalTime(new Date(), centre.timezone)}`,
      generatedBy: user.name,
      requirements,
      description: SYSTEM_DESCRIPTION,
      stats,
      totalEvents: stats.reduce((sum, s) => sum + Number(s.count), 0),
      retentionPolicy: RETENTION_POLICY,
      sample,
      totals: {
        students: new Set(sessions.map((s) => s.studentId)).size,
        sessions: sessions.filter((s) => !s.isOpen).length,
        estimated: estimated.length,
        corrections: corrections?.n ?? 0,
      },
    }),
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="centerline-evidence-${centre.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${from}-to-${to}.pdf"`,
    },
  });
}
