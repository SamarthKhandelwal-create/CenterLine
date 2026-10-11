'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatScheduleTime, weekdayShortName, WEEKDAYS } from '@/lib/schedule/weekday';
import { applyPlanAction, previewPlanAction } from './actions';

type Unscheduled = {
  studentId: string;
  firstName: string;
  lastInitial: string;
  subjects: string[];
};

type Plan = {
  assignments: { studentId: string; firstName: string; lastInitial: string; slots: { weekday: number; startsAt: string }[] }[];
  unplaced: { studentId: string; firstName: string; lastInitial: string; reason: string }[];
  load: { weekday: number; startsAt: string; students: number; capacity: number }[];
};

/** The arrival times these centres actually run, on the half hour from 4 to 7. */
const TIME_OPTIONS = [
  '16:00:00', '16:30:00', '17:00:00', '17:30:00', '18:00:00', '18:30:00', '19:00:00',
];

/**
 * Builds a timetable for students who do not have one.
 *
 * Preview then apply, never apply directly: the plan decides where real children are
 * expected to be, so an instructor reads it before it is written. Applying is two
 * presses for the same reason Confirm all is — one mis-click should not timetable a
 * hundred students.
 */
export function SchedulePlanner({
  unscheduled,
  suggestedDays,
}: {
  unscheduled: Unscheduled[];
  suggestedDays: number[];
}) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<number[]>(suggestedDays.length > 0 ? suggestedDays : [1, 3, 5]);
  const [times, setTimes] = useState<string[]>(['16:00:00', '16:30:00', '17:00:00']);
  const [capacity, setCapacity] = useState(12);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  function preview() {
    setError(null);
    setArmed(false);
    start(async () => {
      const result = await previewPlanAction({ classDays: days, times, capacity });
      if ('error' in result && result.error) {
        setError(result.error);
        setPlan(null);
        return;
      }
      if ('plan' in result) setPlan(result.plan as Plan);
    });
  }

  function apply() {
    if (!plan) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    start(async () => {
      const result = await applyPlanAction({
        assignments: plan.assignments.map((a) => ({ studentId: a.studentId, slots: a.slots })),
      });
      if ('error' in result && result.error) {
        setError(result.error);
        return;
      }
      setPlan(null);
      setArmed(false);
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {unscheduled.length} student{unscheduled.length === 1 ? ' has' : 's have'} no schedule
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Build a timetable for them, or set each one by hand.
          </p>
          <Button onClick={() => setOpen(true)}>Build a schedule</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Build a schedule</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <p className="text-sm font-medium">Class days</p>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((name, weekday) => (
              <Button
                key={name}
                type="button"
                size="sm"
                variant={days.includes(weekday) ? 'default' : 'outline'}
                onClick={() => setDays((d) => toggle(d, weekday))}
              >
                {name.slice(0, 3)}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Arrival times</p>
          <div className="flex flex-wrap gap-2">
            {TIME_OPTIONS.map((time) => (
              <Button
                key={time}
                type="button"
                size="sm"
                variant={times.includes(time) ? 'default' : 'outline'}
                onClick={() => setTimes((t) => toggle(t, time))}
              >
                {formatScheduleTime(time)}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label htmlFor="capacity" className="text-sm font-medium">
            Students per slot
          </label>
          <input
            id="capacity"
            type="number"
            min={1}
            max={200}
            value={capacity}
            onChange={(e) => setCapacity(Math.max(1, Number(e.target.value) || 1))}
            className="h-9 w-20 rounded-md border bg-background px-3 text-sm"
          />
        </div>

        {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}

        <div className="flex items-center gap-2">
          <Button onClick={preview} disabled={pending} variant="outline">
            {pending && !plan ? 'Building…' : 'Preview'}
          </Button>
          {plan ? (
            <>
              <Button onClick={apply} disabled={pending} variant={armed ? 'destructive' : 'default'}>
                {armed
                  ? `Yes — schedule ${plan.assignments.length} student${plan.assignments.length === 1 ? '' : 's'}`
                  : 'Apply'}
              </Button>
              {armed ? (
                <Button variant="ghost" onClick={() => setArmed(false)} disabled={pending}>
                  Cancel
                </Button>
              ) : null}
            </>
          ) : null}
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Close
          </Button>
        </div>

        {plan ? (
          <div className="space-y-4 border-t pt-4">
            <div>
              <p className="mb-2 text-sm font-medium">
                Proposed ({plan.assignments.length})
              </p>
              <ul className="max-h-72 divide-y overflow-y-auto text-sm">
                {plan.assignments.map((a) => (
                  <li key={a.studentId} className="flex items-center justify-between gap-4 py-2">
                    <span>
                      {a.firstName} {a.lastInitial}.
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {a.slots
                        .map((s) => `${weekdayShortName(s.weekday)} ${formatScheduleTime(s.startsAt)}`)
                        .join(', ')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {plan.unplaced.length > 0 ? (
              <div>
                <p className="mb-2 text-sm font-medium">
                  Could not be placed ({plan.unplaced.length})
                </p>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {plan.unplaced.map((u) => (
                    <li key={u.studentId}>
                      {u.firstName} {u.lastInitial}. — {u.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div>
              <p className="mb-2 text-sm font-medium">Resulting load</p>
              <div className="flex flex-wrap gap-2">
                {plan.load.map((slot) => (
                  <Badge
                    key={`${slot.weekday}-${slot.startsAt}`}
                    variant={slot.students >= slot.capacity ? 'red' : 'secondary'}
                  >
                    {weekdayShortName(slot.weekday)} {formatScheduleTime(slot.startsAt)} ·{' '}
                    {slot.students}/{slot.capacity}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
