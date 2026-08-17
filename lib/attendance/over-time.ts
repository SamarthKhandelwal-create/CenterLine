/**
 * The ONE over-time rule, shared by the server (lib/attendance/floor.ts) and the client
 * (components/timers/elapsed.tsx). Deliberately a plain module with neither 'server-only'
 * nor 'use client' on it, because both sides must reach the same verdict.
 *
 * There used to be two rules: the server flagged a student at `expected + 15 minutes`
 * while the client used ratios (amber at 100% of expected, red at 130%). A 30-minute
 * student went red in the grid at 39 minutes but only reached the server's attention
 * list at 45 — the same child, two different answers, on one screen.
 */

/**
 * Grace between "past their allowance" and "over time". A child who runs five minutes
 * long is not a problem; one who runs twenty is.
 */
export const OVER_TIME_GRACE_MINUTES = 15;

/**
 *   normal — inside their allowance
 *   amber  — past it, inside the grace
 *   red    — past it by more than the grace. This is what "over their allotted time"
 *            means, and what the /floor banner counts.
 *
 * An expected time of 0 or less has no meaning to be over, so it never tones — which
 * is what lets the staff shift bar reuse <Elapsed> without ever turning amber.
 */
export function elapsedTone(minutes: number, expectedMinutes: number): 'normal' | 'amber' | 'red' {
  if (expectedMinutes <= 0) return 'normal';
  if (minutes > expectedMinutes + OVER_TIME_GRACE_MINUTES) return 'red';
  if (minutes > expectedMinutes) return 'amber';
  return 'normal';
}

/** True when the student has been here longer than their allowance plus the grace. */
export function isOverTime(minutes: number, expectedMinutes: number): boolean {
  return elapsedTone(minutes, expectedMinutes) === 'red';
}
