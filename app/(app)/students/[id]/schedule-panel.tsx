'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatScheduleTime, weekdayName, WEEKDAYS } from '@/lib/schedule/weekday';
import { saveScheduleAction } from '@/app/(app)/schedule/actions';

export type StudentSlot = { weekday: number; startsAt: string | null; note: string | null };

/**
 * The arrival times these centres run, on the half hour from 4 to 7 — the same list the
 * planner offers, so a hand edit and a generated plan put children in the same slots
 * rather than quietly creating a 4:45 nobody else uses.
 */
const TIME_OPTIONS = [
  '16:00:00', '16:30:00', '17:00:00', '17:30:00', '18:00:00', '18:30:00', '19:00:00',
];

/** Null is a real state here, not a missing value — see the no-fixed-time note below. */
const ANY_TIME = 'any';

/**
 * One student's week, editable.
 *
 * The schedule screen shows the whole centre and plans timetables in bulk; this is the
 * other unit staff work in — "move Ava from Thursday to Monday" — and it is the reason
 * `student_schedule` is one row per student per weekday rather than an array.
 *
 * Saves through the same `saveScheduleAction` the schedule screen uses, so the centre
 * check and the one-entry-per-day rule apply identically. A day is either off, on with a
 * time, or on with no fixed time; that third state is kept because 23 students across
 * these rosters genuinely have it, and collapsing it into a default time would be
 * inventing attendance data.
 */
export function SchedulePanel({
  studentId,
  initial,
}: {
  studentId: string;
  initial: StudentSlot[];
}) {
  const router = useRouter();
  const [slots, setSlots] = useState<StudentSlot[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const byDay = new Map(slots.map((s) => [s.weekday, s]));

  // What the roster said when it could not be read as a time ("Flex/Monthly"). Kept
  // verbatim on import, so it must survive a save that does not touch that day.
  const noteFor = (weekday: number) => initial.find((s) => s.weekday === weekday)?.note ?? null;

  const dirty =
    slots.length !== initial.length ||
    slots.some((s) => {
      const was = initial.find((i) => i.weekday === s.weekday);
      return !was || was.startsAt !== s.startsAt;
    });

  function toggleDay(weekday: number) {
    setSaved(false);
    setSlots((current) =>
      current.some((s) => s.weekday === weekday)
        ? current.filter((s) => s.weekday !== weekday)
        : [...current, { weekday, startsAt: TIME_OPTIONS[2]!, note: noteFor(weekday) }],
    );
  }

  function setTime(weekday: number, value: string) {
    setSaved(false);
    setSlots((current) =>
      current.map((s) =>
        s.weekday === weekday
          ? { ...s, startsAt: value === ANY_TIME ? null : value }
          : s,
      ),
    );
  }

  function save() {
    setError(null);
    start(async () => {
      const result = await saveScheduleAction({
        studentId,
        // `note` is not sent: the action's schema takes weekday and time only, and the
        // command replaces the week. A day whose note matters is one the import set and
        // nobody has edited, which this screen leaves alone.
        slots: slots.map((s) => ({ weekday: s.weekday, startsAt: s.startsAt })),
      });
      if (result && 'error' in result && result.error) {
        setError(result.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Schedule</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          The days this student is expected. Used by Close the day to tell who has not
          arrived — a student with no schedule is never counted as missing.
        </p>

        <ul className="divide-y">
          {WEEKDAYS.map((_, weekday) => {
            const slot = byDay.get(weekday);
            const on = Boolean(slot);
            const note = noteFor(weekday);

            return (
              <li key={weekday} className="flex flex-wrap items-center gap-3 py-2">
                <label className="flex min-w-[9rem] items-center gap-2">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleDay(weekday)}
                    className="h-4 w-4"
                  />
                  <span className={cn('text-sm', on ? 'font-medium' : 'text-muted-foreground')}>
                    {weekdayName(weekday)}
                  </span>
                </label>

                {on ? (
                  <select
                    value={slot!.startsAt ?? ANY_TIME}
                    onChange={(e) => setTime(weekday, e.target.value)}
                    aria-label={`${weekdayName(weekday)} arrival time`}
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {TIME_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {formatScheduleTime(t)}
                      </option>
                    ))}
                    {/* Not a fallback for "unknown": these students come on the day,
                        whenever they come, and so can never be late. */}
                    <option value={ANY_TIME}>Any time</option>
                  </select>
                ) : (
                  <span className="text-sm text-muted-foreground">Not expected</span>
                )}

                {note ? <Badge variant="secondary">{note}</Badge> : null}
              </li>
            );
          })}
        </ul>

        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex items-center gap-3">
          <Button type="button" onClick={save} disabled={pending || !dirty}>
            {pending ? 'Saving…' : 'Save schedule'}
          </Button>
          {saved && !dirty ? (
            <span className="text-sm font-medium text-emerald-700">Saved</span>
          ) : null}
          {slots.length === 0 ? (
            <span className="text-sm text-muted-foreground">
              No days selected — this student will not appear as expected on any day.
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
