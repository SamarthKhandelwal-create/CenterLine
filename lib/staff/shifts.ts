import 'server-only';
import { and, desc, eq, gte, isNull, lt } from 'drizzle-orm';
import { db as defaultDb, type Db } from '@/db';
import { staffShift, user as userT } from '@/db/schema';
import type { StaffShift, UserRole } from '@/db/schema';

export type ShiftRow = {
  id: string;
  userId: string;
  userName: string;
  role: UserRole;
  startedAt: Date;
  endedAt: Date | null;
  /** Null while the shift is open — there is no duration until it ends. */
  durationMinutes: number | null;
  endedByName: string | null;
};

/** The signed-in person's open shift, or null if they are not clocked in. */
export async function currentShift(
  userId: string,
  db: Db = defaultDb,
): Promise<StaffShift | null> {
  const rows = await db
    .select()
    .from(staffShift)
    .where(and(eq(staffShift.userId, userId), isNull(staffShift.endedAt)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Starts a shift. Returns the open shift either way, so a double-tap on Clock in is a
 * no-op rather than an error: `staff_shift_one_open_per_user` rejects the second insert
 * and we hand back the one that already exists.
 */
export async function clockIn(
  userId: string,
  centreId: string,
  at: Date = new Date(),
  db: Db = defaultDb,
): Promise<StaffShift> {
  const existing = await currentShift(userId, db);
  if (existing) return existing;

  const inserted = await db
    .insert(staffShift)
    .values({ userId, centreId, startedAt: at })
    .onConflictDoNothing()
    .returning();

  // Lost the race against another tab: whoever won left an open shift behind.
  return inserted[0] ?? (await currentShift(userId, db))!;
}

/**
 * Ends a shift. Scoped to the centre so an instructor closing a forgotten shift can
 * only ever reach their own staff, and `endedBy` records that they did it rather than
 * the person themselves.
 */
export async function clockOut(
  args: { shiftId: string; centreId: string; byUserId: string; at?: Date },
  db: Db = defaultDb,
): Promise<boolean> {
  const updated = await db
    .update(staffShift)
    .set({ endedAt: args.at ?? new Date(), endedBy: args.byUserId })
    .where(
      and(
        eq(staffShift.id, args.shiftId),
        eq(staffShift.centreId, args.centreId),
        isNull(staffShift.endedAt),
      ),
    )
    .returning({ id: staffShift.id });
  return updated.length > 0;
}

/**
 * Shifts that started in [from, to), newest first. Always scoped to one centre — the
 * two centres in this system never see each other's data, staff included.
 */
export async function shiftsInRange(
  centreId: string,
  from: Date,
  to: Date,
  db: Db = defaultDb,
): Promise<ShiftRow[]> {
  const rows = await db
    .select({
      id: staffShift.id,
      userId: staffShift.userId,
      userName: userT.name,
      role: userT.role,
      startedAt: staffShift.startedAt,
      endedAt: staffShift.endedAt,
      endedById: staffShift.endedBy,
    })
    .from(staffShift)
    .innerJoin(userT, eq(userT.id, staffShift.userId))
    .where(
      and(
        eq(staffShift.centreId, centreId),
        gte(staffShift.startedAt, from),
        lt(staffShift.startedAt, to),
      ),
    )
    .orderBy(desc(staffShift.startedAt));

  // Second pass rather than a self-join: `ended_by` is set on a small minority of rows.
  const closerIds = [...new Set(rows.map((r) => r.endedById).filter((v): v is string => !!v))];
  const closerNames = new Map<string, string>();
  if (closerIds.length > 0) {
    const people = await db
      .select({ id: userT.id, name: userT.name })
      .from(userT)
      .where(eq(userT.centreId, centreId));
    for (const p of people) closerNames.set(p.id, p.name);
  }

  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    userName: r.userName,
    role: r.role,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    durationMinutes:
      r.endedAt === null
        ? null
        : Math.max(0, (r.endedAt.getTime() - r.startedAt.getTime()) / 60_000),
    endedByName: r.endedById ? (closerNames.get(r.endedById) ?? null) : null,
  }));
}
