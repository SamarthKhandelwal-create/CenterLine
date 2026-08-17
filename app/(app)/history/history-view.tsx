'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EstimatedBadge } from '@/components/estimated-badge';
import { formatDuration, formatLocalTime } from '@/lib/time/centre-time';

type SessionView = {
  studentId: string;
  name: string;
  sessionDate: string;
  checkInAt: string;
  checkInMethod: string;
  checkOutAt: string | null;
  checkOutMethod: string | null;
  checkOutBasis: string | null;
  isOpen: boolean;
  isEstimated: boolean;
  durationMinutes: number | null;
};

export function HistoryView({
  timezone,
  from,
  to,
  studentId,
  students,
  sessions,
}: {
  timezone: string;
  from: string;
  to: string;
  studentId?: string;
  students: { id: string; firstName: string; lastInitial: string }[];
  sessions: SessionView[];
}) {
  const router = useRouter();
  const params = useSearchParams();

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`/history?${next.toString()}`);
  };

  const exportHref = `/api/history/export?${new URLSearchParams({
    from,
    to,
    ...(studentId ? { studentId } : {}),
  }).toString()}`;

  const estimatedCount = sessions.filter((s) => s.isEstimated).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="from">From</Label>
          <Input
            id="from"
            type="date"
            defaultValue={from}
            onChange={(e) => setParam('from', e.target.value)}
            className="w-40"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="to">To</Label>
          <Input
            id="to"
            type="date"
            defaultValue={to}
            onChange={(e) => setParam('to', e.target.value)}
            className="w-40"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="studentId">Student</Label>
          <select
            id="studentId"
            defaultValue={studentId ?? ''}
            onChange={(e) => setParam('studentId', e.target.value)}
            className="flex h-10 w-56 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">All students</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.firstName} {s.lastInitial}.
              </option>
            ))}
          </select>
        </div>
        <a href={exportHref} className="ml-auto">
          <Button variant="outline">Export CSV</Button>
        </a>
      </div>

      <p className="text-sm text-muted-foreground">
        {sessions.length} sessions
        {estimatedCount > 0 ? ` · ${estimatedCount} with an estimated check-out` : ''}
      </p>

      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Student</TableHead>
              <TableHead>In</TableHead>
              <TableHead>Out</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>How</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((s, i) => (
              <TableRow key={`${s.studentId}-${s.checkInAt}-${i}`}>
                <TableCell className="tabular-nums">{s.sessionDate}</TableCell>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell className="tabular-nums">
                  {formatLocalTime(new Date(s.checkInAt), timezone)}
                </TableCell>
                <TableCell>
                  {s.isOpen ? (
                    <span className="text-muted-foreground">Still checked in</span>
                  ) : (
                    <span className="inline-flex items-center gap-2 tabular-nums">
                      {s.checkOutAt ? formatLocalTime(new Date(s.checkOutAt), timezone) : '—'}
                      {s.isEstimated ? <EstimatedBadge basis={s.checkOutBasis} /> : null}
                    </span>
                  )}
                </TableCell>
                <TableCell className="tabular-nums">
                  {s.durationMinutes !== null ? formatDuration(s.durationMinutes) : '—'}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {s.checkInMethod.replace('kiosk_', '')}
                  {s.checkOutMethod ? ` / ${s.checkOutMethod.replace('kiosk_', '')}` : ''}
                </TableCell>
              </TableRow>
            ))}
            {sessions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  No sessions in that range.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
