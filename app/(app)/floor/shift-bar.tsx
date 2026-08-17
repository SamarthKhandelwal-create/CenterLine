'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Elapsed } from '@/components/timers/elapsed';
import { clockInAction, clockOutAction } from './shift-actions';

export type ShiftBarProps = {
  userName: string;
  /** Milliseconds since the epoch, or null when off shift. */
  shiftStartedAtMs: number | null;
  startedAtLabel: string | null;
};

/**
 * Clock in / clock out for whoever is signed in. Shown to instructors and assistants
 * alike — the point is a record of who was on the floor, and an instructor is on the
 * floor as much as anyone.
 *
 * Deliberately separate from the account Sign out button in the header: signing out of
 * the app is about a browser session, going off shift is about the building, and doing
 * one is no evidence of the other.
 */
export function ShiftBar({ userName, shiftStartedAtMs, startedAtLabel }: ShiftBarProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const run = (fn: () => Promise<{ error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (result.error) setError(result.error);
      router.refresh();
    });

  const onShift = shiftStartedAtMs !== null;

  return (
    <section
      className={
        onShift
          ? 'flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3'
          : 'flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-background px-4 py-3'
      }
      aria-label="Your shift"
    >
      {onShift ? (
        <>
          <span className="flex items-center gap-2 font-medium text-emerald-900">
            <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
            {userName} — on shift since {startedAtLabel}
          </span>
          {/* expectedMinutes 0: a shift has no allowance, so it never turns amber. */}
          <Elapsed
            startedAtMs={shiftStartedAtMs}
            expectedMinutes={0}
            className="text-lg font-semibold"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            className="ml-auto"
            onClick={() => run(() => clockOutAction(new FormData()))}
          >
            {pending ? 'Clocking out…' : 'Clock out'}
          </Button>
        </>
      ) : (
        <>
          <span className="text-muted-foreground">{userName} — not clocked in</span>
          <Button
            type="button"
            size="sm"
            disabled={pending}
            className="ml-auto"
            onClick={() => run(clockInAction)}
          >
            {pending ? 'Clocking in…' : 'Clock in'}
          </Button>
        </>
      )}
      {error ? (
        <p role="alert" className="w-full text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
