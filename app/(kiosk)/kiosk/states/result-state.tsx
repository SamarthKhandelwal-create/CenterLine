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

  // The kiosk would not check them out: their session has not run long enough. Nothing
  // was recorded, so there is no time to show — only what to do next.
  //
  // Deliberately not the amber "front desk" screen. The front desk cannot help with this,
  // and sending a child there would waste both their time and the desk's. It names the
  // student for the same reason the success screens do: several children queue at one
  // tablet, and a message with no name on it belongs to nobody.
  if (result.kind === 'tooEarly') {
    return (
      <button
        type="button"
        onClick={onDismiss}
        className="flex min-h-screen w-full flex-col items-center justify-center gap-6 bg-violet-700 p-8 text-center text-white"
      >
        <p className="text-8xl font-bold">Not yet</p>
        <p className="text-6xl font-semibold">
          {result.firstName} {result.lastInitial}.
        </p>
        <p className="text-4xl">Please talk to your instructor.</p>
      </button>
    );
  }

  // Staff shifts reuse the same two colours: green for arriving, blue for leaving. What
  // changes is the wording — a shift is clocked, not checked, and the person is named in
  // full because they are staff rather than a child at the door.
  if (result.kind === 'staff') {
    const clockedIn = result.action === 'clock_in';
    return (
      <button
        type="button"
        onClick={onDismiss}
        className={`flex min-h-screen w-full flex-col items-center justify-center gap-6 p-8 text-center text-white ${
          clockedIn ? 'bg-emerald-600' : 'bg-blue-600'
        }`}
      >
        <p className="text-8xl font-bold">{clockedIn ? 'Clocked in' : 'Clocked out'}</p>
        <p className="text-6xl font-semibold">{result.name}</p>
        <p className="text-4xl">{formatLocalTime(new Date(result.occurredAt), timezone)}</p>
        {!clockedIn && result.durationMinutes !== null ? (
          <p className="text-3xl opacity-90">{formatDuration(result.durationMinutes)} on shift</p>
        ) : null}
      </button>
    );
  }

  const checkedIn = result.action === 'check_in';

  // A tap inside the 20-second grace window records nothing and replays the previous
  // result. Saying "Checked in" there is actively misleading: the student tapped a tile
  // that said Check out, so the screen looks like it is refusing to let them leave.
  // Name what actually happened, and say what to do about it.
  const headline = result.repeated
    ? checkedIn
      ? 'Already checked in'
      : 'Already checked out'
    : checkedIn
      ? 'Checked in'
      : 'Checked out';

  return (
    <button
      type="button"
      onClick={onDismiss}
      className={`flex min-h-screen w-full flex-col items-center justify-center gap-6 p-8 text-center text-white ${
        checkedIn ? 'bg-emerald-600' : 'bg-blue-600'
      }`}
    >
      <p className="text-8xl font-bold">{headline}</p>
      <p className="text-6xl font-semibold">
        {result.firstName} {result.lastInitial}.
      </p>
      <p className="text-4xl">{formatLocalTime(new Date(result.occurredAt), timezone)}</p>
      {result.repeated ? (
        <p className="text-3xl opacity-90">Wait a moment, then tap again</p>
      ) : null}
      {!checkedIn && !result.repeated && result.durationMinutes !== null ? (
        <p className="text-3xl opacity-90">{formatDuration(result.durationMinutes)} today</p>
      ) : null}
    </button>
  );
}
