import Link from 'next/link';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { guardian as guardianT, student as studentT, studentGuardian } from '@/db/schema';
import { requireInstructor } from '@/lib/auth/current-user';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StudentsTable } from './students-table';

export const dynamic = 'force-dynamic';

export default async function StudentsPage() {
  const { centre } = await requireInstructor();

  const rows = await db
    .select({
      id: studentT.id,
      firstName: studentT.firstName,
      lastInitial: studentT.lastInitial,
      subjects: studentT.subjects,
      expectedMinutes: studentT.expectedMinutes,
      status: studentT.status,
      releaseMode: studentT.releaseMode,
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
    .where(eq(studentT.centreId, centre.id))
    .orderBy(studentT.firstName, studentT.lastInitial);

  const activeCount = rows.filter((r) => r.status === 'active').length;
  const consentCount = rows.filter((r) => r.smsConsent).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Students</h1>
          <p className="text-sm text-muted-foreground">
            {activeCount} active · {rows.length - activeCount} inactive ·{' '}
            <Badge variant={consentCount > 0 ? 'green' : 'secondary'}>{consentCount} SMS consent</Badge>
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/students/import">
            <Button variant="outline">Import roster</Button>
          </Link>
          <Link href="/students/cards" prefetch={false}>
            <Button variant="outline">Print QR cards</Button>
          </Link>
          <Link href="/students/new">
            <Button>Add student</Button>
          </Link>
        </div>
      </div>

      <StudentsTable
        students={rows.map((r) => ({
          ...r,
          subjects: r.subjects ?? [],
          guardianName: r.guardianName ?? null,
          guardianPhone: r.guardianPhone ?? null,
          smsConsent: r.smsConsent ?? false,
        }))}
      />
    </div>
  );
}
