'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { staffCheckInAction } from './actions';

export type NotPresentStudent = { id: string; firstName: string; lastInitial: string };

/**
 * Front-desk check-in. The kiosk handles the normal case; this is for the child who
 * lost their card and forgot their PIN, which is precisely who the kiosk's amber
 * screen sends to the desk.
 */
export function CheckInDialog({
  students,
  onClose,
}: {
  students: NotPresentStudent[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...students].sort(
      (a, b) => a.firstName.localeCompare(b.firstName) || a.lastInitial.localeCompare(b.lastInitial),
    );
    if (!q) return sorted.slice(0, 40);
    return sorted
      .filter((s) => `${s.firstName} ${s.lastInitial}`.toLowerCase().includes(q))
      .slice(0, 40);
  }, [students, query]);

  const checkIn = (s: NotPresentStudent) => {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set('studentId', s.id);
      const result = await staffCheckInAction(fd);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setDone(`${s.firstName} ${s.lastInitial}. checked in`);
      router.refresh();
      setTimeout(() => setDone(null), 2500);
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-16"
      role="dialog"
      aria-modal="true"
      aria-label="Check a student in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[75vh] w-full max-w-lg flex-col rounded-lg border bg-background p-5 shadow-lg">
        <div className="mb-3">
          <h2 className="text-lg font-semibold">Check a student in</h2>
          <p className="text-sm text-muted-foreground">
            For a student who cannot use the kiosk. Recorded as a staff check-in under your
            name, with the current time.
          </p>
        </div>

        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name…"
          aria-label="Search students to check in"
          autoFocus
        />

        {error ? (
          <p role="alert" className="mt-2 text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}
        {done ? <p className="mt-2 text-sm font-medium text-emerald-700">{done}</p> : null}

        <ul className="mt-3 flex-1 space-y-1 overflow-y-auto">
          {filtered.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                disabled={pending}
                onClick={() => checkIn(s)}
                className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left hover:bg-accent disabled:opacity-50"
              >
                <span className="font-medium">
                  {s.firstName} {s.lastInitial}.
                </span>
                <span className="text-sm text-muted-foreground">Check in</span>
              </button>
            </li>
          ))}
          {filtered.length === 0 ? (
            <li className="py-8 text-center text-sm text-muted-foreground">
              {students.length === 0
                ? 'Everyone on the roster is already checked in.'
                : 'No student matches that search.'}
            </li>
          ) : null}
        </ul>

        <div className="mt-4 flex justify-end">
          <Button type="button" variant="ghost" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
