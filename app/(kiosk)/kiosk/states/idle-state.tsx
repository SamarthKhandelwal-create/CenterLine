'use client';

import { useEffect, useState } from 'react';
import { ExitPanel } from '../exit-panel';

/** Idle: centre name, the prompt, one large button, a clock. */
export function IdleState({
  centreName,
  timezone,
  onFindName,
}: {
  centreName: string;
  timezone: string;
  onFindName: () => void;
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
          Tap your card or find your name
        </h1>

        <button
          type="button"
          onClick={onFindName}
          className="min-h-[140px] w-full max-w-2xl rounded-2xl bg-white text-5xl font-bold text-slate-900 active:scale-[0.98]"
        >
          Find my name
        </button>

        {/* The screen never asks which one — it works out whether this is an arrival or
            a departure. Saying so is the only thing that was missing: a student who
            wanted to leave had no way to know this was also the way out. */}
        <p className="text-2xl text-slate-400">
          Hold your card under the scanner — the same way in and out
        </p>
      </div>

      {/* Deliberately quiet next to the 140px name button: staff know it is here, and a
          child has no reason to reach for it. Unauthenticated, so the confirm step in
          ExitPanel is what stops a stray press. */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setExiting(true)}
          className="min-h-[44px] rounded-lg px-4 text-base font-medium text-slate-500 hover:text-slate-300"
        >
          Staff
        </button>
      </div>

      {exiting ? <ExitPanel onCancel={() => setExiting(false)} /> : null}
    </div>
  );
}
