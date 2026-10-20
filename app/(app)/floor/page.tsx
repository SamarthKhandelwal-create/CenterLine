import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { student as studentT } from '@/db/schema';
import { requireSession } from '@/lib/auth/current-user';
import { getFloorData } from '@/lib/attendance/floor';
import { minutesUsedTodayByStudent } from '@/lib/attendance/queries';
import { isReEntryBlocked } from '@/lib/attendance/time-used';
import { guardiansForStudents } from '@/lib/sms/send';
import { FloorBoard } from './floor-board';

export const dynamic = 'force-dynamic';

export default async function FloorPage() {
  const { centre } = await requireSession();
  const { present, pastCloseGrace } = await getFloorData(centre);

  // Active students who are not currently in the building, for front-desk check-in.
  const roster = await db
    .select({
      id: studentT.id,
      firstName: studentT.firstName,
      lastInitial: studentT.lastInitial,
      expectedMinutes: studentT.expectedMinutes,
    })
    .from(studentT)
    .where(and(eq(studentT.centreId, centre.id), eq(studentT.status, 'active')))
    .orderBy(studentT.firstName, studentT.lastInitial);
  const presentIds = new Set(present.map((s) => s.studentId));

  // How much of today each absent student has already spent, so the desk can see who the
  // kiosk is turning away and why. One query for the whole roster rather than one per
  // student: this runs on a board that refreshes every ten seconds.
  const usedByStudent = await minutesUsedTodayByStudent(centre.id, centre.timezone);
  const notPresent = roster
    .filter((s) => !presentIds.has(s.id))
    .map((s) => {
      const used = usedByStudent.get(s.id) ?? 0;
      return {
        id: s.id,
        firstName: s.firstName,
        lastInitial: s.lastInitial,
        usedMinutes: used,
        expectedMinutes: s.expectedMinutes,
        // The kiosk has stopped letting this student back in; checking them in here is
        // an override, and the dialog says so.
        kioskBlocked: isReEntryBlocked(used, s.expectedMinutes),
      };
    });

  const guardians = await guardiansForStudents(present.map((s) => s.studentId));
  const guardianByStudent = new Map<string, { name: string; phone: string; smsConsent: boolean }>();
  for (const g of guardians) {
    if (!guardianByStudent.has(g.studentId)) {
      guardianByStudent.set(g.studentId, { name: g.name, phone: g.phone, smsConsent: g.smsConsent });
    }
  }

  const toClient = (s: (typeof present)[number]) => ({
    studentId: s.studentId,
    firstName: s.firstName,
    lastInitial: s.lastInitial,
    subjects: s.subjects,
    expectedMinutes: s.expectedMinutes,
    checkInAtMs: s.checkInAt.getTime(),
    guardian: guardianByStudent.get(s.studentId) ?? null,
    // A wall-clock fact, identical for everyone present — never a reason to list a
    // student twice, which is what the old attention band did with it.
    pastClose: s.pastClose,
  });

  return (
    <FloorBoard
      present={present.map(toClient)}
      centreName={centre.name}
      notPresent={notPresent}
      pastCloseGrace={pastCloseGrace}
    />
  );
}
