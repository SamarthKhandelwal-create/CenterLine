'use client';

import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/time/centre-time';
import { elapsedTone } from '@/lib/attendance/over-time';
import { useNow } from './tick-provider';

// The rule itself lives in lib/attendance/over-time.ts so the server reaches the same
// verdict. Re-exported here because every existing caller imports it from this file.
export { elapsedTone, isOverTime, OVER_TIME_GRACE_MINUTES } from '@/lib/attendance/over-time';

const TONE_CLASS = {
  normal: 'text-foreground',
  amber: 'text-amber-700',
  red: 'text-red-700',
} as const;

export function Elapsed({
  startedAtMs,
  expectedMinutes,
  className,
}: {
  startedAtMs: number;
  expectedMinutes: number;
  className?: string;
}) {
  const now = useNow();
  // Before mount, render the same string the server produced: 0 elapsed.
  const minutes = now === null ? 0 : Math.max(0, (now - startedAtMs) / 60_000);
  const tone = now === null ? 'normal' : elapsedTone(minutes, expectedMinutes);

  return (
    <span
      className={cn('font-mono tabular-nums', TONE_CLASS[tone], className)}
      suppressHydrationWarning
    >
      {now === null ? '—' : formatDuration(minutes)}
    </span>
  );
}
