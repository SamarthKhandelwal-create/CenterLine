import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { student as studentT } from '@/db/schema';
import { getKioskCentre } from '@/lib/auth/current-user';
import { presentStudents } from '@/lib/attendance/queries';
import { KioskShell } from './kiosk-shell';

export const dynamic = 'force-dynamic';

export default async function KioskPage() {
  const centre = await getKioskCentre();
  if (!centre) redirect('/kiosk/enroll');

  // Only what a tablet by the door needs: first name and last initial. No phone
  // numbers, no full names, no history — if the tablet walks, nothing walks with it.
  const roster = await db
    .select({
      id: studentT.id,
      firstName: studentT.firstName,
      lastInitial: studentT.lastInitial,
    })
    .from(studentT)
    .where(and(eq(studentT.centreId, centre.id), eq(studentT.status, 'active')))
    .orderBy(studentT.firstName, studentT.lastInitial);

  const present = await presentStudents(centre.id, centre.timezone);
  const presentIds = present.map((p) => p.studentId);

  return (
    <KioskShell
      centreName={centre.name}
      timezone={centre.timezone}
      roster={roster}
      presentIds={presentIds}
    />
  );
}
