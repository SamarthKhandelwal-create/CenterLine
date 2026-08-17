/**
 * Every centre-local date computation in this app goes through here.
 *
 * Vercel functions run in UTC. Computing "today" with `new Date().getDate()` rolls
 * the day at 5pm local for a US centre, silently attributing evening attendance to
 * tomorrow. These helpers use Intl with an explicit timeZone instead, which is
 * DST-correct, and the multi-row query paths compute boundaries in SQL.
 */

/** Centre-local calendar date as YYYY-MM-DD. */
export function localDateString(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Centre-local wall-clock hour and minute. */
export function localHourMinute(at: Date, timezone: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  return { hour: get('hour') % 24, minute: get('minute') };
}

function offsetMinutes(at: Date, timezone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const p = dtf.formatToParts(at);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? '0');
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  // Drop sub-second precision on both sides so the difference is a whole number of minutes.
  const atSeconds = Math.floor(at.getTime() / 1000) * 1000;
  return (asUtc - atSeconds) / 60_000;
}

/**
 * The instant corresponding to a centre-local wall-clock time on a given local date.
 * Resolves the offset at that approximate instant, so DST is handled correctly.
 */
export function instantFromLocal(
  dateStr: string,
  time: { hour: number; minute: number },
  timezone: string,
): Date {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const guess = new Date(Date.UTC(y, m - 1, d, time.hour, time.minute, 0));
  const off = offsetMinutes(guess, timezone);
  const first = new Date(guess.getTime() - off * 60_000);
  const off2 = offsetMinutes(first, timezone);
  return off2 === off ? first : new Date(guess.getTime() - off2 * 60_000);
}

/** Parses a Postgres `time` value ("19:00:00") into hour and minute. */
export function parseTimeOfDay(value: string): { hour: number; minute: number } {
  const [h, m] = value.split(':');
  return { hour: Number(h ?? 0), minute: Number(m ?? 0) };
}

/** Centre-local close instant for the local day containing `at`. */
export function closeInstantFor(at: Date, timezone: string, closeTime: string): Date {
  return instantFromLocal(localDateString(at, timezone), parseTimeOfDay(closeTime), timezone);
}

export function formatLocalTime(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(at);
}

export function formatLocalDate(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(at);
}

/** "1h 05m" / "45m" — for elapsed timers and session durations. */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
