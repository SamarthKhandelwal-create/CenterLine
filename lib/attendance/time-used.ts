/**
 * The ONE re-entry rule: how much of a student's daily allowance must already be spent
 * before the kiosk stops checking them back in.
 *
 * A plain module with neither 'server-only' nor 'use client' on it, the same shape as
 * lib/attendance/early-departure.ts and lib/attendance/over-time.ts — the kiosk enforces
 * it on the server and the floor screen explains it to staff, and neither may hold a
 * second copy of the threshold.
 *
 * This is the third rule drawn on the same allowance, and all three treat it differently
 * on purpose:
 *
 *   over-time         — stayed too long. Shown to staff, never prevented.
 *   early-departure   — leaving too soon. Stopped at the tablet.
 *   re-entry (here)   — coming back after most of the day is spent. Stopped at the
 *                       tablet, but an instructor can still check them in from /floor.
 *
 * The override is the difference from early-departure, and it is deliberate: a child
 * trying to leave early needs a reason to stay, which the desk cannot supply, whereas a
 * child asking to come back may well have one an instructor can judge.
 */

/**
 * The fraction of the allowance that, once spent, closes the kiosk to further check-ins.
 * Half, as specified. Expressed as a constant because the copy on the floor screen states
 * it, and a number in prose that drifts from the number in the rule is how a screen starts
 * lying.
 */
export const RE_ENTRY_FRACTION = 0.5;

/**
 * Minutes of the allowance a student may spend and still be let back in at the kiosk.
 *
 * Derived by rounding, so a 45-minute allowance gives 23 rather than 22.5 — the rule is
 * compared against whole recorded minutes, and a half-minute threshold could never be hit
 * exactly.
 */
export function reEntryThreshold(expectedMinutes: number): number {
  if (expectedMinutes <= 0) return 0;
  return Math.round(expectedMinutes * RE_ENTRY_FRACTION);
}

/**
 * True when the kiosk should refuse a further check-in.
 *
 * Strictly greater than the threshold: a 30-minute student who has used exactly 15 is at
 * half, not past it, and is still let in. "More than half" is the specified wording and
 * this is the boundary it names.
 *
 * An expected time of 0 or less has no meaning to be half of, so it never blocks — a
 * student whose allowance was never set must not be locked out of the building, the same
 * reasoning that keeps such a student from being trapped inside it by early-departure.
 */
export function isReEntryBlocked(usedMinutes: number, expectedMinutes: number): boolean {
  if (expectedMinutes <= 0) return false;
  return usedMinutes > reEntryThreshold(expectedMinutes);
}
