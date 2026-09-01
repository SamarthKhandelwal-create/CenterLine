import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { student as studentT } from '@/db/schema';
import { requireSession } from '@/lib/auth/current-user';
import { getFloorData } from '@/lib/attendance/floor';
import { guardiansForStudents } from '@/lib/sms/send';
import { FloorBoard } from './floor-board';

export const dynamic = 'force-dynamic';

export default async function FloorPage() {
  const { centre } = await requireSession();
  const { present, pastCloseGrace } = await getFloorData(centre);

  // Active students who are not currently in the building, for front-desk check-in.
  const roster = await db
    .select({ id: studentT.id, firstName: studentT.firstName, lastInitial: studentT.lastInitial })
    .from(studentT)
    .where(and(eq(studentT.centreId, centre.id), eq(studentT.status, 'active')))
    .orderBy(studentT.firstName, studentT.lastInitial);
  const presentIds = new Set(present.map((s) => s.studentId));
  const notPresent = roster.filter((s) => !presentIds.has(s.id));

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
