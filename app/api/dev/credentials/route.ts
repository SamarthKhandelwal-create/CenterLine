import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { attendanceEvent, student as studentT } from '@/db/schema';
import { presentStudents } from '@/lib/attendance/queries';
import { getSession } from '@/lib/auth/current-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Development helper for the browser verification script. Returns the demo QR tokens,
 * which is exactly the kind of thing that must never exist in production —
 * hence the hard 404 below. Credentials are stored only as HMACs, so these come from
 * the deterministic seed, not from the database.
 */
export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse('Not found', { status: 404 });
  }

  const { seedCredentialsFor } = await import('@/db/demo-credentials');
  // Scope to the signed-in user's centre — with more than one centre seeded, taking
  // whichever row came back first would hand out another centre's students.
  const session = await getSession();
  if (!session) return NextResponse.json({ students: [], presentIds: [] }, { status: 401 });
  const centre = session.centre;

  const roster = await db
    .select({ id: studentT.id, firstName: studentT.firstName, lastInitial: studentT.lastInitial })
    .from(studentT)
    .where(and(eq(studentT.centreId, centre.id), eq(studentT.status, 'active')))
    .orderBy(studentT.firstName)
    .limit(60);

  const withCreds = await seedCredentialsFor(roster);
  const present = await presentStudents(centre.id, centre.timezone);
  const lastEvent = (
    await db
      .select({
        type: attendanceEvent.type,
        captureMethod: attendanceEvent.captureMethod,
        occurredAt: attendanceEvent.occurredAt,
      })
      .from(attendanceEvent)
      .where(eq(attendanceEvent.centreId, centre.id))
      .orderBy(desc(attendanceEvent.occurredAt))
      .limit(1)
  )[0];

  return NextResponse.json({
    centre: { id: centre.id, name: centre.name, timezone: centre.timezone },
    students: withCreds,
    presentIds: present.map((p) => p.studentId),
    lastEvent,
  });
}
