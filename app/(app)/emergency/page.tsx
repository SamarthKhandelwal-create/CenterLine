import { requireSession } from '@/lib/auth/current-user';
import { presentStudents } from '@/lib/attendance/queries';
import { guardiansForStudents } from '@/lib/sms/send';
import { formatLocalDate, formatLocalTime } from '@/lib/time/centre-time';
import { Suspense } from 'react';
import { PrintButton } from '@/components/print-button';
import { AutoPrint } from './auto-print';

export const dynamic = 'force-dynamic';

/**
 * Fire drill screen. Everything here is optimised for being read at arm's length by
 * someone standing in a car park: large type, high contrast, no colour-only signals,
 * and a print stylesheet that fits the roster on as few sheets as possible.
 */
export default async function EmergencyPage() {
  const { centre } = await requireSession();
  const at = new Date();
  const present = await presentStudents(centre.id, centre.timezone, at);

  const guardians = await guardiansForStudents(present.map((s) => s.studentId));
  const primaryByStudent = new Map<string, { name: string; phone: string }>();
  for (const g of guardians) {
    if (!primaryByStudent.has(g.studentId)) {
      primaryByStudent.set(g.studentId, { name: g.name, phone: g.phone });
    }
  }

  return (
    <div className="space-y-4">
      <Suspense fallback={null}>
        <AutoPrint />
      </Suspense>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Students in the building</h1>
          <p className="mt-1 text-lg" suppressHydrationWarning>
            {centre.name} · {formatLocalDate(at, centre.timezone)} ·{' '}
            {formatLocalTime(at, centre.timezone)}
          </p>
          <p className="mt-2 text-4xl font-bold tabular-nums">
            {present.length} {present.length === 1 ? 'student' : 'students'}
          </p>
        </div>
        <PrintButton label="Print roster" />
      </div>

      {present.length === 0 ? (
        <p className="rounded-lg border-4 border-black p-8 text-center text-2xl font-bold">
          The building is empty. Nobody is checked in.
        </p>
      ) : (
        <table className="w-full border-collapse text-lg">
          <thead>
            <tr className="border-b-4 border-black text-left">
              <th className="py-2 pr-3">Name</th>
              <th className="py-2 pr-3">In</th>
              <th className="py-2 pr-3">Release</th>
              <th className="py-2">Guardian</th>
            </tr>
          </thead>
          <tbody>
            {present.map((s) => {
              const g = primaryByStudent.get(s.studentId);
              return (
                <tr key={s.studentId} className="border-b-2 border-black/30">
                  <td className="py-2 pr-3 text-xl font-bold">
                    {s.firstName} {s.lastInitial}.
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    {formatLocalTime(s.checkInAt, centre.timezone)}
                  </td>
                  <td className="py-2 pr-3 font-semibold uppercase">
                    {s.releaseMode === 'self_release' ? 'Self' : 'Guardian'}
                  </td>
                  <td className="py-2">
                    {g ? (
                      <span>
                        <span className="font-semibold">{g.phone}</span>
                        <span className="block text-base">{g.name}</span>
                      </span>
                    ) : (
                      <span className="font-semibold">No guardian on file</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <p className="print-only pt-4 text-sm" suppressHydrationWarning>
        Printed {formatLocalDate(at, centre.timezone)} at {formatLocalTime(at, centre.timezone)}.
        This list reflects check-ins recorded at that moment.
      </p>
    </div>
  );
}
