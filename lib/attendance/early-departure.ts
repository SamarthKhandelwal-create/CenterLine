import { MINUTES_PER_SUBJECT } from '@/lib/students/expected-minutes';

/**
 * The ONE early-departure rule: how long a student must have been here before the kiosk
 * will let them check out.
 *
 * A plain module with neither 'server-only' nor 'use client' on it, the same shape as
 * lib/attendance/over-time.ts — the kiosk enforces it on the server and the seed applies
 * it in a script, and neither may hold a second copy of the threshold.
 *
 * Over-time and early-departure are opposite ends of the same allowance, and they are
 * deliberately not treated alike. A student who stays too long is *shown* to staff and
 * nothing is prevented; a student who tries to leave too early is stopped at the tablet,
 * because by the time it is on a screen they are already out of the door.
 */

/**
 * How much of each subject's time a student may leave unspent and still be free to go.
 * Five minutes of a thirty-minute subject, so the grace grows with the session: a
 * two-subject student is here twice as long and twice as much of it can go missing.
 *
 * In practice: the kiosk refuses under 25 minutes for one subject, under 50 for two.
 */
export const EARLY_DEPARTURE_GRACE_PER_SUBJECT = 5;

/**
 * The grace for one student's allowance.
 *
 * Derived from the allowance rather than taking a subject count, because
 * `student.expected_minutes` is a single integer and an import may set it to something
 * that is not a clean multiple of 30. Rounding to the nearest whole subject is what a
 * 45-minute allowance gets: two subjects' worth of grace, being closer to two sessions
 * than to one.
 */
export function earlyDepartureGrace(expectedMinutes: number): number {
  if (expectedMinutes <= 0) return 0;
  const subjects = Math.max(1, Math.round(expectedMinutes / MINUTES_PER_SUBJECT));
  return EARLY_DEPARTURE_GRACE_PER_SUBJECT * subjects;
}

/**
 * The point below which the kiosk will not check a student out — 25 minutes for one
 * subject, 50 for two. Exported for copy that has to state the number, so what is on a
 * screen cannot drift from what is enforced.
 */
export function earlyDepartureThreshold(expectedMinutes: number): number {
  return Math.max(0, expectedMinutes - earlyDepartureGrace(expectedMinutes));
}

/**
 * True when a session is too short to end at the kiosk.
 *
 * Strictly less than the threshold: a one-subject student at exactly 25 minutes is inside
 * the grace and free to go, as is a two-subject student at exactly 50. An expected time of
 * 0 or less has no meaning to fall short of, so it never blocks — a student whose
 * allowance was never set must not be trapped at the door.
 */
export function isEarlyDeparture(actualMinutes: number, expectedMinutes: number): boolean {
  if (expectedMinutes <= 0) return false;
  return actualMinutes < earlyDepartureThreshold(expectedMinutes);
}
