/**
 * How long a student is expected to be in the centre, derived from how many subjects
 * they take. The brief says "30 per subject"; `student.expected_minutes` is a single
 * integer, so a two-subject student with genuinely different per-subject durations
 * still cannot be represented — see NOTES.md.
 *
 * This lived as a bare `30 *` in five places (import commit, import analyze, the two
 * student actions, the seed) and they could drift apart. One definition instead.
 */
export const MINUTES_PER_SUBJECT = 30;

/** Never returns 0: a student with no recorded subject still gets one session. */
export function expectedMinutesFor(subjects: readonly string[]): number {
  return MINUTES_PER_SUBJECT * Math.max(1, subjects.length);
}
