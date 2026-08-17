'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export type StudentRow = {
  id: string;
  firstName: string;
  lastInitial: string;
  subjects: string[];
  expectedMinutes: number;
  status: 'active' | 'inactive';
  releaseMode: 'guardian_pickup' | 'self_release';
  guardianName: string | null;
  guardianPhone: string | null;
  smsConsent: boolean;
};

export function StudentsTable({ students }: { students: StudentRow[] }) {
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return students.filter((s) => {
      if (!showInactive && s.status === 'inactive') return false;
      if (!q) return true;
      return (
        `${s.firstName} ${s.lastInitial}`.toLowerCase().includes(q) ||
        s.subjects.some((sub) => sub.toLowerCase().includes(q)) ||
        (s.guardianName ?? '').toLowerCase().includes(q) ||
        (s.guardianPhone ?? '').includes(q)
      );
    });
  }, [students, query, showInactive]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, subject, or guardian…"
          className="max-w-sm"
          aria-label="Search students"
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="h-4 w-4"
          />
          Show inactive
        </label>
        <span className="ml-auto text-sm text-muted-foreground">{filtered.length} shown</span>
      </div>

      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Subjects</TableHead>
              <TableHead>Expected</TableHead>
              <TableHead>Guardian</TableHead>
              <TableHead>Release</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <Link href={`/students/${s.id}`} className="font-medium hover:underline">
                    {s.firstName} {s.lastInitial}.
                  </Link>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {s.subjects.map((sub) => (
                      <Badge key={sub} variant="secondary">
                        {sub}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="tabular-nums">{s.expectedMinutes}m</TableCell>
                <TableCell>
                  {s.guardianName ? (
                    <span className="text-sm">
                      {s.guardianName}
                      <span className="block text-xs text-muted-foreground">
                        {s.guardianPhone}{' '}
                        {s.smsConsent ? (
                          <Badge variant="green">SMS ok</Badge>
                        ) : (
                          <Badge variant="secondary">No SMS</Badge>
                        )}
                      </span>
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {s.releaseMode === 'self_release' ? 'Self' : 'Guardian'}
                </TableCell>
                <TableCell>
                  {s.status === 'active' ? (
                    <Badge variant="green">Active</Badge>
                  ) : (
                    <Badge variant="secondary">Inactive</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  No students match that search.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
