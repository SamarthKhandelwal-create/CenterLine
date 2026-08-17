import { sessionsInRange } from '@/lib/attendance/queries';
import { localDateString, addDays, formatLocalTime, formatDuration } from '@/lib/time/centre-time';
import { EstimatedBadge } from '@/components/estimated-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export async function StudentHistoryPanel({
  studentId,
  centreId,
  timezone,
}: {
  studentId: string;
  centreId: string;
  timezone: string;
}) {
  const today = localDateString(new Date(), timezone);
  const sessions = await sessionsInRange(centreId, addDays(today, -30), today, { studentId });

  if (sessions.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Last 30 days</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>In</TableHead>
              <TableHead>Out</TableHead>
              <TableHead>Duration</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.slice(0, 15).map((s) => (
              <TableRow key={s.checkInAt.toISOString()}>
                <TableCell>{s.sessionDate}</TableCell>
                <TableCell>{formatLocalTime(s.checkInAt, timezone)}</TableCell>
                <TableCell>
                  {s.isOpen ? (
                    <span className="text-muted-foreground">Still here</span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      {s.checkOutAt ? formatLocalTime(s.checkOutAt, timezone) : '—'}
                      {s.isEstimated ? <EstimatedBadge basis={s.checkOutBasis} /> : null}
                    </span>
                  )}
                </TableCell>
                <TableCell className="tabular-nums">
                  {s.durationMinutes !== null ? formatDuration(s.durationMinutes) : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
