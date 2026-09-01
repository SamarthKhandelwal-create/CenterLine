import 'server-only';
import { eq, sql } from 'drizzle-orm';
import { db as defaultDb, type Db } from '@/db';
import { staffShift, user as userT } from '@/db/schema';
import type { UserRole } from '@/db/schema';
import { toCsv } from '@/lib/csv';
import { formatDuration, formatLocalDate, formatLocalTime } from '@/lib/time/centre-time';
import { shiftsInRange } from './shifts';

export type StaffExportRow = {
  name: string;
  email: string;
  role: UserRole;
  shiftCount: number;
  totalMinutes: number;
  lastShiftAt: Date | null;
  onShiftNow: boolean;
};

/**
 * The staff list, with each person's shift record summarised alongside them.
 *
 * The counts span the whole log rather than a window: this is the "who works here"
 * document, and a person who has not been in for three months is exactly the row an
 * instructor is looking for when they open it.
 */
export async function staffForExport(centreId: string, db: Db = defaultDb): Promise<StaffExportRow[]> {
  const people = await db
    .select({ id: userT.id, name: userT.name, email: userT.email, role: userT.role })
    .from(userT)
    .where(eq(userT.centreId, centreId))
    .orderBy(userT.name);

  // Aggregated in one grouped pass rather than by pulling every shift into memory — a
  // centre with two years of history has thousands of rows and this file has three.
  const stats = await db
    .select({
      userId: staffShift.userId,
      shiftCount: sql<number>`count(*)::int`,
      totalMinutes: sql<number>`COALESCE(round(sum(
        EXTRACT(EPOCH FROM (${staffShift.endedAt} - ${staffShift.startedAt})) / 60
      ) FILTER (WHERE ${staffShift.endedAt} IS NOT NULL)), 0)::int`,
      lastShiftAt: sql<string | Date | null>`max(${staffShift.startedAt})`,
      openCount: sql<number>`(count(*) FILTER (WHERE ${staffShift.endedAt} IS NULL))::int`,
    })
    .from(staffShift)
    .where(eq(staffShift.centreId, centreId))
    .groupBy(staffShift.userId);

  const byUser = new Map(stats.map((s) => [s.userId, s]));

  return people.map((p) => {
    const s = byUser.get(p.id);
    return {
      name: p.name,
      email: p.email,
      role: p.role,
      shiftCount: s?.shiftCount ?? 0,
      totalMinutes: s?.totalMinutes ?? 0,
      // PGlite hands `max(timestamptz)` back as a string; Neon hands back a Date.
      lastShiftAt: s?.lastShiftAt ? new Date(s.lastShiftAt) : null,
      onShiftNow: (s?.openCount ?? 0) > 0,
    };
  });
}

/**
 * The staff list as CSV.
 *
 * Name, Email and Role come first and are spelled exactly as the importer reads them,
 * so this file can be edited in a spreadsheet and fed straight back to /staff/import.
 * The remaining columns are a record of what happened, not settings — the importer
 * ignores them. No password or hash is ever written here.
 */
export function staffListCsv(
  centreName: string,
  timezone: string,
  today: string,
  rows: StaffExportRow[],
): string {
  return toCsv([
    ['STAFF', centreName, `exported ${today}`],
    ['Name', 'Email', 'Role', 'Shifts recorded', 'Hours recorded', 'Last shift', 'On shift now'],
    ...rows.map((r) => [
      r.name,
      r.email,
      r.role,
      r.shiftCount,
      formatDuration(r.totalMinutes),
      r.lastShiftAt ? formatLocalDate(r.lastShiftAt, timezone) : '',
      r.onShiftNow ? 'yes' : 'no',
    ]),
  ]);
}

/** Every shift in the window, one row each. Open shifts are named as open, not blank. */
export async function shiftLogCsv(
  args: { centreId: string; centreName: string; timezone: string; from: Date; to: Date },
  db: Db = defaultDb,
): Promise<string> {
  const shifts = await shiftsInRange(args.centreId, args.from, args.to, db);

  return toCsv([
    ['STAFF SHIFTS', args.centreName, `exported ${formatLocalDate(new Date(), args.timezone)}`],
    ['Date', 'Name', 'Email', 'Role', 'In', 'Out', 'Minutes', 'Duration', 'Closed by'],
    ...shifts.map((s) => [
      formatLocalDate(s.startedAt, args.timezone),
      s.userName,
      s.userEmail,
      s.role,
      formatLocalTime(s.startedAt, args.timezone),
      s.endedAt ? formatLocalTime(s.endedAt, args.timezone) : 'still on shift',
      s.durationMinutes === null ? '' : Math.round(s.durationMinutes),
      s.durationMinutes === null ? '' : formatDuration(s.durationMinutes),
      // Blank when the person clocked themselves out, which is the ordinary case.
      s.endedByName && s.endedByName !== s.userName ? s.endedByName : '',
    ]),
  ]);
}
