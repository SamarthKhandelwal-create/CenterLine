import { requireInstructor } from '@/lib/auth/current-user';
import { csvResponse } from '@/lib/csv';
import { shiftLogCsv, staffForExport, staffListCsv } from '@/lib/staff/export';
import { localDateString } from '@/lib/time/centre-time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_SHIFT_DAYS = 90;
const MAX_SHIFT_DAYS = 3650;

/**
 * Two documents, chosen by `kind`, rather than one combined file: the staff list is
 * meant to be edited and handed back to /staff/import, and a shift log stapled
 * underneath it would break that round trip.
 *
 * Instructor only, and scoped to the signed-in centre — the same posture as /staff
 * itself. Neither document contains a password or a hash.
 */
export async function GET(request: Request) {
  const { centre } = await requireInstructor();
  const url = new URL(request.url);
  const today = localDateString(new Date(), centre.timezone);
  const slug = centre.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();

  if (url.searchParams.get('kind') === 'shifts') {
    const requested = Number(url.searchParams.get('days'));
    const days =
      Number.isFinite(requested) && requested > 0
        ? Math.min(Math.floor(requested), MAX_SHIFT_DAYS)
        : DEFAULT_SHIFT_DAYS;
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60_000);

    const csv = await shiftLogCsv({
      centreId: centre.id,
      centreName: centre.name,
      timezone: centre.timezone,
      from,
      to,
    });
    return csvResponse(`centerline-staff-shifts-${slug}-${today}.csv`, csv);
  }

  const rows = await staffForExport(centre.id);
  return csvResponse(
    `centerline-staff-${slug}-${today}.csv`,
    staffListCsv(centre.name, centre.timezone, today, rows),
  );
}
