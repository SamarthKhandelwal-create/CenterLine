'use client';

import { useEffect, useState } from 'react';
import { ExitPanel } from '../exit-panel';

/** Idle: centre name, the prompt, one large button, a clock. */
export function IdleState({
  centreName,
  timezone,
  onFindName,
  onStaffShifts,
}: {
  centreName: string;
  timezone: string;
  onFindName: () => void;
  /** Null hides the staff strip entirely — see KioskPage on who gets it. */
  onStaffShifts: (() => void) | null;
}) {
  const [now, setNow] = useState<Date | null>(null);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const clock = now
    ? new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(now)
    : '';

  return (
    <div className="flex min-h-screen flex-col bg-slate-900 p-8 text-white">
      <div className="flex items-start justify-between">
        <p className="text-3xl font-semibold">{centreName}</p>
        <p className="font-mono text-3xl tabular-nums" suppressHydrationWarning>
          {clock}
        </p>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-12">
        <h1 className="max-w-4xl text-center text-6xl font-bold leading-tight">
          Find your name to check in or out
        </h1>

        <button
          type="button"
          onClick={onFindName}
          className="min-h-[140px] w-full max-w-2xl rounded-2xl bg-white text-5xl font-bold text-slate-900 active:scale-[0.98]"
        >
          Find my name
        </button>

        {/* The screen never asks which one — it works out whether this is an arrival or
            a departure. Saying so still matters: a student who wants to leave has no
            other way to know this is also the way out. */}
        <p className="text-2xl text-slate-400">
          The same button both ways — coming in and going home
        </p>
      </div>

      {/* The bottom strip is the staff end of the screen. Both buttons are deliberately
          quiet next to the 140px name button — a child has no reason to reach for either,
          and neither is authenticated, which is why the exit keeps its confirm step. */}
      <div className="flex items-center justify-between gap-4">
        {onStaffShifts ? (
          // The only way to start or end a shift: /floor no longer offers it. Large
          // enough to hit while holding a coat, small enough not to compete with the
          // student button above it.
          <button
            type="button"
            onClick={onStaffShifts}
            className="min-h-[72px] rounded-xl border-2 border-slate-600 px-8 text-2xl font-semibold text-slate-200 active:scale-[0.98] hover:border-slate-400 hover:text-white"
          >
            Staff clock in / out
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => setExiting(true)}
          className="min-h-[44px] rounded-lg px-4 text-base font-medium text-slate-500 hover:text-slate-300"
        >
          Exit kiosk
        </button>
      </div>

      {exiting ? <ExitPanel onCancel={() => setExiting(false)} /> : null}
    </div>
  );
}
