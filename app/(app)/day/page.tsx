import { requireSession } from '@/lib/auth/current-user';
import {
  absentStudents,
  presentStudents,
  unconfirmedInferredSessions,
} from '@/lib/attendance/queries';
import {
  formatDuration,
  formatLocalDate,
  formatLocalTime,
  localDateString,
} from '@/lib/time/centre-time';
import Link from 'next/link';
import { expectedToday } from '@/lib/schedule/queries';
import { formatScheduleTime } from '@/lib/schedule/weekday';
import { EstimatedBadge } from '@/components/estimated-badge';
import { Badge } from '@/components/ui/badge';
import { ConfirmAllButton, ConfirmButton, CheckOutNowButton } from './day-actions';
import type { SessionRow } from '@/lib/attendance/queries';

export const dynamic = 'force-dynamic';

export default async function DayPage() {
  const { centre } = await requireSession();
  const at = new Date();
  const today = localDateString(at, centre.timezone);

  const [inferred, absent, present, expected] = await Promise.all([
    unconfirmedInferredSessions(centre.id, centre.timezone, at),
    absentStudents(centre.id, centre.timezone, at),
    presentStudents(centre.id, centre.timezone, at),
    expectedToday(centre.id, centre.timezone, at),
  ]);

  // Scheduled for today and not yet seen. `expected` being empty means this centre
  // has no schedules for today at all, which the fallback section below handles.
  const missing = expected.filter((s) => !s.arrived);

  // Today's estimates are the close-out task. Anything older is a backlog that still
  // has to be clearable — an unreviewed estimate keeps requirement 3 in breach.
  const todaysEstimates = inferred.filter((s) => s.sessionDate === today);
  const backlog = inferred.filter((s) => s.sessionDate !== today);

  // A student who never arrived is not "done for the day". Whichever list is on
  // screen — the scheduled one, or the fallback for a centre with no schedules yet —
  // the banner must not sit above a list of children nobody has accounted for and
  // claim everything is closed out.
  const unaccountedFor = expected.length > 0 ? missing.length : absent.length;
  const nothingToDo = inferred.length === 0 && present.length === 0 && unaccountedFor === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Close the day</h1>
        <p className="text-sm text-muted-foreground" suppressHydrationWarning>
          {formatLocalDate(at, centre.timezone)}
        </p>
      </div>

      {/* Each section renders only when it has something in it. */}
      {todaysEstimates.length > 0 ? (
        <EstimateSection
          title={`Estimated check-outs to confirm (${todaysEstimates.length})`}
          blurb="Nobody saw these students leave. The system closed the session at closing time. Confirming records that you checked — it does not change the time."
          confirmAllLabel="every estimate from today"
          sessions={todaysEstimates}
          timezone={centre.timezone}
        />
      ) : null}

      {backlog.length > 0 ? (
        <EstimateSection
          title={`Earlier estimates still unconfirmed (${backlog.length})`}
          blurb="These are from previous days. Until they are reviewed they stay marked as estimates, and the compliance check for “actual arrival and departure” stays amber."
          confirmAllLabel="every earlier estimate"
          sessions={backlog}
          timezone={centre.timezone}
          showDate
        />
      ) : null}

      {present.length > 0 ? (
        <section className="space-y-2 rounded-lg border p-4">
          <h2 className="font-semibold">Still checked in ({present.length})</h2>
          <p className="text-sm text-muted-foreground">
            Check them out before closing, or leave them — the hourly job will close them at
            closing time and mark the time as estimated.
          </p>
          <ul className="space-y-2">
            {present.map((s) => (
              <li key={s.studentId} className="flex items-center gap-3 rounded-md border bg-white p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {s.firstName} {s.lastInitial}.
                  </p>
                  {/* Elapsed is derived from "now", and Next renders the HTML and the
                      RSC payload a moment apart — straddling a minute boundary would
                      otherwise be a hydration mismatch. This is a snapshot as of page
                      load, which is what a close-out screen wants. */}
                  <p className="text-sm text-muted-foreground" suppressHydrationWarning>
                    In {formatLocalTime(s.checkInAt, centre.timezone)} ·{' '}
                    {formatDuration((at.getTime() - s.checkInAt.getTime()) / 60_000)} so far
                  </p>
                </div>
                <CheckOutNowButton studentId={s.studentId} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {missing.length > 0 ? (
        <section className="space-y-2 rounded-lg border p-4">
          <h2 className="font-semibold">Expected but not seen today ({missing.length})</h2>
          {/* Scheduled for today and not here. Before the schedule existed this listed
              every active student who had not come in, which on a Monday meant the
              Tuesday and Thursday children too — a list so long it said nothing. */}
          <div className="flex flex-wrap gap-2">
            {missing.map((s) => (
              <Badge key={s.studentId} variant="secondary" className="px-2 py-1 text-sm">
                {s.firstName} {s.lastInitial}.
                {formatScheduleTime(s.startsAt) ? (
                  <span className="ml-1 font-normal opacity-70">
                    {formatScheduleTime(s.startsAt)}
                  </span>
                ) : null}
              </Badge>
            ))}
          </div>
        </section>
      ) : null}

      {/* A centre that has not set schedules up yet still needs the old answer, or
          this screen silently loses a section it used to have. */}
      {expected.length === 0 && absent.length > 0 ? (
        <section className="space-y-2 rounded-lg border p-4">
          <h2 className="font-semibold">Not seen today ({absent.length})</h2>
          <p className="text-sm text-muted-foreground">
            No schedules are set for today, so this is every active student who has not
            been in. <Link href="/schedule" className="underline">Set up schedules</Link> to
            narrow it to who was actually expected.
          </p>
          <div className="flex flex-wrap gap-2">
            {absent.map((s) => (
              <Badge key={s.studentId} variant="secondary" className="px-2 py-1 text-sm">
                {s.firstName} {s.lastInitial}.
              </Badge>
            ))}
          </div>
        </section>
      ) : null}

      {nothingToDo ? (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-6 text-center">
          <p className="text-lg font-semibold text-emerald-900">Everything is closed out.</p>
          <p className="mt-1 text-sm text-emerald-900">
            No open sessions and no estimates waiting. You are done for the day.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function EstimateSection({
  title,
  blurb,
  confirmAllLabel,
  sessions,
  timezone,
  showDate = false,
}: {
  title: string;
  blurb: string;
  confirmAllLabel: string;
  sessions: SessionRow[];
  timezone: string;
  showDate?: boolean;
}) {
  // Only rows that still carry an estimate event can be confirmed; a session with no
  // check-out id has nothing to supersede, and its row renders without a button too.
  const confirmable = sessions.map((s) => s.checkOutId).filter((id): id is string => Boolean(id));

  return (
    <section className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-amber-900">{title}</h2>
          <p className="text-sm text-amber-900">{blurb}</p>
        </div>
        {/* One row is already one press away — the bulk button earns its place at two. */}
        {confirmable.length > 1 ? (
          <ConfirmAllButton eventIds={confirmable} label={confirmAllLabel} />
        ) : null}
      </div>
      <ul className="space-y-2">
        {sessions.map((s) => (
          <li
            key={s.checkOutId ?? `${s.studentId}-${s.checkInAt.toISOString()}`}
            className="flex flex-wrap items-center gap-3 rounded-md border bg-white p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {s.firstName} {s.lastInitial}.
                {showDate ? (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {s.sessionDate}
                  </span>
                ) : null}
              </p>
              <p className="text-sm text-muted-foreground">
                In {formatLocalTime(s.checkInAt, timezone)} · out{' '}
                {s.checkOutAt ? formatLocalTime(s.checkOutAt, timezone) : '—'}{' '}
                <EstimatedBadge basis={s.checkOutBasis} />
              </p>
            </div>
            {s.checkOutId ? <ConfirmButton eventId={s.checkOutId} /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
