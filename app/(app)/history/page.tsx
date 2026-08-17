import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { student as studentT } from '@/db/schema';
import { requireInstructor } from '@/lib/auth/current-user';
import { sessionsInRange } from '@/lib/attendance/queries';
import { addDays, localDateString } from '@/lib/time/centre-time';
import { HistoryView } from './history-view';

export const dynamic = 'force-dynamic';

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; studentId?: string }>;
}) {
  const { centre } = await requireInstructor();
  const sp = await searchParams;

  const today = localDateString(new Date(), centre.timezone);
  const from = sp.from || addDays(today, -14);
  const to = sp.to || today;
  const studentId = sp.studentId || undefined;

  const [sessions, students] = await Promise.all([
    sessionsInRange(centre.id, from, to, { studentId }),
    db
      .select({ id: studentT.id, firstName: studentT.firstName, lastInitial: studentT.lastInitial })
      .from(studentT)
      .where(eq(studentT.centreId, centre.id))
      .orderBy(studentT.firstName, studentT.lastInitial),
  ]);

  return (
    <HistoryView
      timezone={centre.timezone}
      from={from}
      to={to}
      studentId={studentId}
      students={students}
      sessions={sessions.map((s) => ({
        studentId: s.studentId,
        name: `${s.firstName} ${s.lastInitial}.`,
        sessionDate: s.sessionDate,
        checkInAt: s.checkInAt.toISOString(),
        checkInMethod: s.checkInMethod,
        checkOutAt: s.checkOutAt?.toISOString() ?? null,
        checkOutMethod: s.checkOutMethod,
        checkOutBasis: s.checkOutBasis,
        isOpen: s.isOpen,
        isEstimated: s.isEstimated,
        durationMinutes: s.durationMinutes,
      }))}
    />
  );
}
