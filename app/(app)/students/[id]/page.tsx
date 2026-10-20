import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { guardian as guardianT, student as studentT, studentGuardian } from '@/db/schema';
import { requireInstructor } from '@/lib/auth/current-user';
import { scheduleForStudent } from '@/lib/schedule/queries';
import { StudentForm } from '../student-form';
import { StudentHistoryPanel } from './history-panel';
import { SchedulePanel } from './schedule-panel';

export const dynamic = 'force-dynamic';

export default async function EditStudentPage({ params }: { params: Promise<{ id: string }> }) {
  const { centre } = await requireInstructor();
  const { id } = await params;

  const rows = await db
    .select({
      student: studentT,
      guardianName: guardianT.name,
      guardianPhone: guardianT.phone,
      smsConsent: guardianT.smsConsent,
    })
    .from(studentT)
    .leftJoin(
      studentGuardian,
      and(eq(studentGuardian.studentId, studentT.id), eq(studentGuardian.isPrimary, true)),
    )
    .leftJoin(guardianT, eq(guardianT.id, studentGuardian.guardianId))
    .where(and(eq(studentT.id, id), eq(studentT.centreId, centre.id)))
    .limit(1);

  const row = rows[0];
  if (!row) notFound();
  const s = row.student;

  // After the ownership check above, so a student at another centre is a 404 rather than
  // a page that quietly reveals their week.
  const schedule = await scheduleForStudent(s.id);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        {s.firstName} {s.lastInitial}.
      </h1>
      <StudentForm
        initial={{
          id: s.id,
          firstName: s.firstName,
          lastInitial: s.lastInitial,
          subjects: s.subjects ?? [],
          expectedMinutes: s.expectedMinutes,
          status: s.status,
          releaseMode: s.releaseMode,
          guardianName: row.guardianName,
          guardianPhone: row.guardianPhone,
          smsConsent: row.smsConsent ?? false,
        }}
      />
      <SchedulePanel
        studentId={s.id}
        initial={schedule.map((e) => ({
          weekday: e.weekday,
          startsAt: e.startsAt,
          note: e.note,
        }))}
      />
      <StudentHistoryPanel studentId={s.id} centreId={centre.id} timezone={centre.timezone} />
    </div>
  );
}
