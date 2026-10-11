/**
 * Weekday helpers. A plain module with neither 'server-only' nor 'use client' on it,
 * the same shape as lib/attendance/over-time.ts, so the schedule screens can render a
 * day name on the client without a round trip.
 *
 * 0=Sunday..6=Saturday throughout: JS getUTCDay(), Postgres EXTRACT(DOW) and these
 * helpers all agree, so a weekday number never needs translating at a boundary.
 */

export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export function isWeekday(value: number): value is Weekday {
  return Number.isInteger(value) && value >= 0 && value <= 6;
}

export function weekdayName(weekday: number): string {
  return WEEKDAYS[weekday] ?? 'Unknown';
}

export function weekdayShortName(weekday: number): string {
  return (WEEKDAYS[weekday] ?? 'Unknown').slice(0, 3);
}

const WEEKDAY_ALIASES: Record<string, Weekday> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

/** Parses a column header or user-typed day ("Mon", "tuesday") to a weekday number. */
export function parseWeekday(raw: string): Weekday | null {
  const key = raw.toLowerCase().replace(/[^a-z]+/g, '');
  return WEEKDAY_ALIASES[key] ?? null;
}

/**
 * The centre-local weekday of an instant.
 *
 * Deliberately not `at.getDay()`, which reads the SERVER's zone: on Vercel (UTC) a
 * Saturday 8pm session in New York reports Sunday, so a Saturday student would be
 * absent from their own class day. Formatting in the centre's zone is what makes this
 * correct, and it stays correct across DST.
 */
export function localWeekday(at: Date, timezone: string): Weekday {
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  }).format(at);
  const parsed = parseWeekday(name);
  // Intl always returns one of the seven short names for these locales.
  return parsed ?? 0;
}

/** "17:30:00" -> "5:30 PM". Null stays null — a day with no fixed time. */
export function formatScheduleTime(value: string | null): string | null {
  if (!value) return null;
  const [h, m] = value.split(':');
  const hour = Number(h ?? 0);
  const minute = Number(m ?? 0);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${String(minute).padStart(2, '0')} ${suffix}`;
}

/**
 * Parses the arrival times these rosters carry ("5:00 PM", "11:00 AM", "17:00") into
 * a Postgres `time` literal. Anything that is not a clock time — "Flex/Monthly" — is
 * not a time and returns null; the caller keeps the original text as a note.
 */
export function parseScheduleTime(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  const match = /^(\d{1,2})\s*:\s*(\d{2})\s*(am|pm)?$/i.exec(value);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toLowerCase();

  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'pm' && hour !== 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
  } else if (hour > 23) {
    return null;
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
}
