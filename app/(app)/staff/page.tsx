import { requireInstructor } from '@/lib/auth/current-user';
import { shiftsInRange } from '@/lib/staff/shifts';
import {
  formatDuration,
  formatLocalDate,
  formatLocalTime,
} from '@/lib/time/centre-time';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CloseShiftButton } from './close-shift-button';

export const dynamic = 'force-dynamic';

const DAYS = 14;

/**
 * Who was on the floor, and when. Instructor only — an assistant clocks in and out on
 * /floor but does not review anybody's hours, including their own beyond the current
 * shift. The assistant allow-list in middleware.ts is positive, so /staff is locked for
 * them without a change there.
 */
export default async function StaffPage() {
  const { centre } = await requireInstructor();

  const to = new Date();
  const from = new Date(to.getTime() - DAYS * 24 * 60 * 60_000);
  const shifts = await shiftsInRange(centre.id, from, to);

  const open = shifts.filter((s) => s.endedAt === null);
  const totalMinutes = shifts.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Staff shifts</h1>
        <p className="text-sm text-muted-foreground">
          Last {DAYS} days · {shifts.length} {shifts.length === 1 ? 'shift' : 'shifts'} ·{' '}
          {formatDuration(totalMinutes)} recorded
        </p>
      </div>

      {open.length > 0 ? (
        <section className="rounded-lg border border-emerald-300 bg-emerald-50 p-3">
          <p className="text-sm font-medium text-emerald-900">
            {open.length} {open.length === 1 ? 'person is' : 'people are'} on shift now:{' '}
            {open.map((s) => s.userName).join(', ')}
          </p>
        </section>
      ) : null}

      {shifts.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground">
          No shifts recorded yet. Staff clock in from the floor board.
        </p>
      ) : (
        <div className="rounded-lg border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Who</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>In</TableHead>
                <TableHead>Out</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shifts.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <span className="font-medium">{s.userName}</span>{' '}
                    <span className="text-muted-foreground">{s.role}</span>
                  </TableCell>
                  <TableCell suppressHydrationWarning>
                    {formatLocalDate(s.startedAt, centre.timezone)}
                  </TableCell>
                  <TableCell suppressHydrationWarning>
                    {formatLocalTime(s.startedAt, centre.timezone)}
                  </TableCell>
                  <TableCell suppressHydrationWarning>
                    {s.endedAt ? (
                      <>
                        {formatLocalTime(s.endedAt, centre.timezone)}
                        {s.endedByName && s.endedByName !== s.userName ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            closed by {s.endedByName}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <Badge variant="secondary">On shift</Badge>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {s.durationMinutes === null ? '—' : formatDuration(s.durationMinutes)}
                  </TableCell>
                  <TableCell className="text-right">
                    {/* A shift left open overnight is the common case worth fixing from
                        here; the person who worked it has usually gone home. */}
                    {s.endedAt === null ? <CloseShiftButton shiftId={s.id} /> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
