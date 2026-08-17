import { requireSession } from '@/lib/auth/current-user';
import { sessionsInRange } from '@/lib/attendance/queries';
import { csvResponse, toCsv } from '@/lib/csv';
import { formatLocalDate, formatLocalTime, localDateString, addDays } from '@/lib/time/centre-time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { centre } = await requireSession();
  const url = new URL(request.url);
  const today = localDateString(new Date(), centre.timezone);
  const from = url.searchParams.get('from') || addDays(today, -30);
  const to = url.searchParams.get('to') || today;
  const studentId = url.searchParams.get('studentId') || undefined;

  const sessions = await sessionsInRange(centre.id, from, to, { studentId });

  const rows: (string | number | null)[][] = [
    [
      'Date',
      'Student',
      'Check in',
      'Check in method',
      'Check out',
      'Check out method',
      'Minutes',
      'Estimated',
      'Basis',
      'Confirmed',
    ],
    ...sessions.map((s) => [
      s.sessionDate,
      `${s.firstName} ${s.lastInitial}.`,
      formatLocalTime(s.checkInAt, centre.timezone),
      s.checkInMethod,
      s.checkOutAt ? formatLocalTime(s.checkOutAt, centre.timezone) : '',
      s.checkOutMethod ?? (s.isOpen ? 'still checked in' : ''),
      s.durationMinutes ?? '',
      // Spelled out, not a symbol: this column is the difference between an
      // observed time and one the system guessed.
      s.isEstimated ? 'ESTIMATED - not observed' : 'observed',
      s.checkOutBasis ?? '',
      s.checkOutConfirmedAt ? formatLocalDate(s.checkOutConfirmedAt, centre.timezone) : '',
    ]),
  ];

  return csvResponse(`centerline-attendance-${from}-to-${to}.csv`, toCsv(rows));
}
