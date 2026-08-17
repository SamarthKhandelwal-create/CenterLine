'use client';

import { formatDuration, formatLocalTime } from '@/lib/time/centre-time';
import type { KioskResult } from '../kiosk-shell';

/**
 * Full-bleed coloured screen for 2.5 seconds. Green for checked in, blue for
 * checked out, amber for any problem.
 *
 * The amber screen says the same thing for every cause — unknown card, revoked card,
 * wrong PIN three times. A child is never told why they failed.
 */
export function ResultState({
  result,
  timezone,
  onDismiss,
}: {
  result: KioskResult;
  timezone: string;
  onDismiss: () => void;
}) {
  if (result.kind === 'error') {
    return (
      <button
        type="button"
        onClick={onDismiss}
        className="flex min-h-screen w-full flex-col items-center justify-center gap-6 bg-amber-500 p-8 text-center text-white"
      >
        <p className="text-7xl font-bold">Please see the front desk</p>
      </button>
    );
  }

  const checkedIn = result.action === 'check_in';
  return (
    <button
      type="button"
      onClick={onDismiss}
      className={`flex min-h-screen w-full flex-col items-center justify-center gap-6 p-8 text-center text-white ${
        checkedIn ? 'bg-emerald-600' : 'bg-blue-600'
      }`}
    >
      <p className="text-8xl font-bold">{checkedIn ? 'Checked in' : 'Checked out'}</p>
      <p className="text-6xl font-semibold">
        {result.firstName} {result.lastInitial}.
      </p>
      <p className="text-4xl">{formatLocalTime(new Date(result.occurredAt), timezone)}</p>
      {!checkedIn && result.durationMinutes !== null ? (
        <p className="text-3xl opacity-90">{formatDuration(result.durationMinutes)} today</p>
      ) : null}
    </button>
  );
}
