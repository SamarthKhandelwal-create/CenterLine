import { requireInstructor } from '@/lib/auth/current-user';
import { weekSchedule, schedulesNeedingReview } from '@/lib/schedule/queries';
import { centreClassDays } from '@/lib/schedule/commands';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatScheduleTime, weekdayName, WEEKDAYS } from '@/lib/schedule/weekday';
import { SchedulePlanner } from './schedule-planner';

export const dynamic = 'force-dynamic';

export default async function SchedulePage() {
  const { centre } = await requireInstructor();
  const [week, review, classDays] = await Promise.all([
    weekSchedule(centre.id),
    schedulesNeedingReview(centre.id),
    centreClassDays(centre.id),
  ]);

  // Days the centre teaches first; a day with nobody on it is noise on this screen.
  const taughtDays = WEEKDAYS.map((_, i) => i).filter((i) => (week.byWeekday[i] ?? []).length > 0);
  const total = taughtDays.reduce((n, d) => n + (week.byWeekday[d] ?? []).length, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Schedule</h1>
        <p className="text-sm text-muted-foreground">
          {total === 0
            ? 'No student has a schedule yet.'
            : `${total} expected sessions a week across ${taughtDays.length} day${taughtDays.length === 1 ? '' : 's'}.`}
        </p>
      </div>

      {week.unscheduled.length > 0 ? (
        <SchedulePlanner
          unscheduled={week.unscheduled}
          suggestedDays={classDays.map((d) => d.weekday)}
        />
      ) : null}

      {review.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Needs an arrival time ({review.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* These came in from the roster with a day but no time against them.
                They are real expectations; they just cannot be late. */}
            <ul className="divide-y text-sm">
              {review.map((r) => (
                <li key={`${r.studentId}-${r.weekday}`} className="flex items-center gap-3 py-2">
                  <span className="font-medium">
                    {r.firstName} {r.lastInitial}.
                  </span>
                  <span className="text-muted-foreground">{weekdayName(r.weekday)}</span>
                  {r.note ? <Badge variant="secondary">{r.note}</Badge> : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {taughtDays.map((weekday) => {
          const students = week.byWeekday[weekday] ?? [];
          return (
            <Card key={weekday}>
              <CardHeader>
                <CardTitle className="text-base">
                  {weekdayName(weekday)}{' '}
                  <span className="font-normal text-muted-foreground">({students.length})</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y text-sm">
                  {students.map((s) => (
                    <li key={s.studentId} className="flex items-center justify-between py-2">
                      <span>
                        {s.firstName} {s.lastInitial}.
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatScheduleTime(s.startsAt) ?? s.note ?? 'Any time'}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
