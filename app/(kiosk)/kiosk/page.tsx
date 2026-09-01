import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { student as studentT } from '@/db/schema';
import { getKioskDevice } from '@/lib/auth/current-user';
import { presentStudents } from '@/lib/attendance/queries';
import { staffShiftStatus } from '@/lib/staff/shifts';
import { KioskShell } from './kiosk-shell';

export const dynamic = 'force-dynamic';

export default async function KioskPage() {
  const device = await getKioskDevice();
  if (!device) redirect('/kiosk/enroll');
  const { centre } = device;

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

  // Null, not empty, when the tablet was not set up by an instructor: the difference is
  // "this device does not offer staff clocking" rather than "nobody works here", and the
  // panel is hidden entirely rather than shown empty.
  const staff =
    device.enrolledByRole === 'instructor'
      ? (await staffShiftStatus(centre.id)).map((s) => ({
          id: s.userId,
          name: s.name,
          onShiftSinceMs: s.startedAt?.getTime() ?? null,
        }))
      : null;

  return (
    <KioskShell
      centreName={centre.name}
      timezone={centre.timezone}
      roster={roster}
      presentIds={presentIds}
      staff={staff}
    />
  );
}
