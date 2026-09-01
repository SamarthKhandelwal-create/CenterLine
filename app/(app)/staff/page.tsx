import Link from 'next/link';
import { requireInstructor } from '@/lib/auth/current-user';
import { shiftsInRange } from '@/lib/staff/shifts';
import {
  formatDuration,
  formatLocalDate,
  formatLocalTime,
} from '@/lib/time/centre-time';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const dynamic = 'force-dynamic';

const DAYS = 14;

/**
 * The table shows a fortnight because that is what fits on a screen; the export covers
 * a quarter, because the reason to open a spreadsheet is usually a question the screen
 * cannot answer.
 */
const SHIFT_EXPORT_DAYS = 90;

/**
 * Who was on the floor, and when. Read-only: shifts start and end at the kiosk by the
 * door, so there is nothing to press here — this screen is the record, not the control.
 *
 * Instructor only. An assistant clocks in and out at the kiosk but does not review
 * anybody's hours, including their own. The assistant allow-list in middleware.ts is
 * positive, so /staff is locked for them without a change there.
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Staff shifts</h1>
          <p className="text-sm text-muted-foreground">
            Last {DAYS} days · {shifts.length} {shifts.length === 1 ? 'shift' : 'shifts'} ·{' '}
            {formatDuration(totalMinutes)} recorded
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Plain links, not buttons with handlers: these are file downloads, and the
              browser should treat them as such even if JavaScript never arrives. */}
          <a href="/api/staff/export" download>
            <Button variant="outline">Export staff list</Button>
          </a>
          <a href={`/api/staff/export?kind=shifts&days=${SHIFT_EXPORT_DAYS}`} download>
            <Button variant="outline">Export shifts</Button>
          </a>
          <Link href="/staff/import">
            <Button>Import staff</Button>
          </Link>
        </div>
      </div>

      {open.length > 0 ? (
        <section className="rounded-lg border border-emerald-300 bg-emerald-50 p-3">
          <p className="text-sm font-medium text-emerald-900">
            {open.length} {open.length === 1 ? 'person is' : 'people are'} on shift now:{' '}
            {open.map((s) => s.userName).join(', ')}
          </p>
          {/* A shift left open overnight used to be closed from this table. It is closed
              at the kiosk now — one tap on that person's tile — which keeps every shift
              boundary coming from the same place. */}
          <p className="mt-1 text-sm text-emerald-800">
            A shift left open by mistake is closed at the kiosk: Staff clock in / out,
            then tap that person.
          </p>
        </section>
      ) : null}

      {shifts.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground">
          No shifts recorded yet. Staff clock in and out at the kiosk.
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
