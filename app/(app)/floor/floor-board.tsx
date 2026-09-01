'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Elapsed, elapsedTone } from '@/components/timers/elapsed';
import { TickProvider, useNow } from '@/components/timers/tick-provider';
import { formatDuration } from '@/lib/time/centre-time';
import { cn } from '@/lib/utils';
import { staffCheckOutAction, sweepOverdueAction } from './actions';
import { MessageDialog } from './message-dialog';
import { CheckInDialog, type NotPresentStudent } from './check-in-dialog';

export type FloorCard = {
  studentId: string;
  firstName: string;
  lastInitial: string;
  subjects: string[];
  expectedMinutes: number;
  checkInAtMs: number;
  guardian: { name: string; phone: string; smsConsent: boolean } | null;
  pastClose: boolean;
};

export function FloorBoard({
  present,
  centreName,
  notPresent,
  pastCloseGrace,
}: {
  present: FloorCard[];
  centreName: string;
  notPresent: NotPresentStudent[];
  pastCloseGrace: boolean;
}) {
  return (
    <TickProvider intervalMs={10_000}>
      <FloorInner
        present={present}
        centreName={centreName}
        notPresent={notPresent}
        pastCloseGrace={pastCloseGrace}
      />
    </TickProvider>
  );
}

function FloorInner({
  present,
  centreName,
  notPresent,
  pastCloseGrace,
}: {
  present: FloorCard[];
  centreName: string;
  notPresent: NotPresentStudent[];
  pastCloseGrace: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [messageTarget, setMessageTarget] = useState<FloorCard | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const now = useNow();

  // Data refresh every 10s. Paused while hidden; resyncs the moment the tab returns,
  // so a tablet left asleep does not show a stale board.
  //
  // Past close + 60 minutes it also runs the sweep that closes forgotten sessions.
  // The hourly cron does this too, but cron does not run in local development and is
  // daily-only on a Vercel Hobby plan — so without this the feature is invisible on
  // exactly the deployments where someone is most likely to be watching for it. The
  // sweep is idempotent, so several open boards racing each other is harmless.
  const sweeping = useRef(false);
  useEffect(() => {
    const sweep = async () => {
      if (!pastCloseGrace || present.length === 0 || sweeping.current) return;
      sweeping.current = true;
      try {
        const result = await sweepOverdueAction();
        if (result.inserted > 0) router.refresh();
      } catch {
        // A failed sweep is not worth interrupting the board for; cron is the backstop.
      } finally {
        sweeping.current = false;
      }
    };

    const tick = () => {
      if (document.hidden) return;
      router.refresh();
      void sweep();
    };
    const id = setInterval(tick, 10_000);
    const onVisible = () => {
      if (!document.hidden) {
        router.refresh();
        void sweep();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    void sweep();
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [router, pastCloseGrace, present.length]);

  const minutesSince = (startedAtMs: number) =>
    now === null ? 0 : Math.max(0, (now - startedAtMs) / 60_000);

  /**
   * Over their allotted time — the allowance being 30 minutes per subject, set at
   * import. Derived here from the tick that is already running rather than handed down
   * by the server, so the banner counts up live between refreshes and cannot disagree
   * with the tone on the cards the way the old attention band did.
   */
  const overTime = useMemo(
    () =>
      now === null
        ? []
        : present.filter(
            (s) => elapsedTone(minutesSince(s.checkInAtMs), s.expectedMinutes) === 'red',
          ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [present, now],
  );

  // Over-time students lead the grid, so the banner and the grid tell the same story.
  const ordered = useMemo(() => {
    const over = new Set(overTime.map((s) => s.studentId));
    return [...present].sort((a, b) => {
      const byFlag = Number(over.has(b.studentId)) - Number(over.has(a.studentId));
      if (byFlag !== 0) return byFlag;
      return a.checkInAtMs - b.checkInAtMs;
    });
  }, [present, overTime]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ordered;
    return ordered.filter(
      (s) =>
        s.firstName.toLowerCase().includes(q) ||
        `${s.firstName} ${s.lastInitial}`.toLowerCase().includes(q) ||
        s.subjects.some((sub) => sub.toLowerCase().includes(q)),
    );
  }, [ordered, query]);

  return (
    <div className="space-y-4">
      {/* Renders nothing at all when nobody is over time: no header, no empty state,
          zero height. When it does render it is meant to be readable across the room. */}
      {overTime.length > 0 ? (
        <section
          role="status"
          className="rounded-xl border-2 border-red-500 bg-red-50 p-5 shadow-sm"
        >
          <p className="text-3xl font-bold uppercase tracking-tight text-red-800">
            {overTime.length} {overTime.length === 1 ? 'student is' : 'students are'} over time
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {overTime.map((s) => (
              <li
                key={s.studentId}
                className="flex items-center gap-3 rounded-lg border border-red-300 bg-white px-3 py-2"
              >
                <span className="text-lg font-semibold">
                  {s.firstName} {s.lastInitial}.
                </span>
                <span className="text-lg">
                  <Elapsed
                    startedAtMs={s.checkInAtMs}
                    expectedMinutes={s.expectedMinutes}
                    className="font-bold"
                  />
                  <span className="text-muted-foreground"> of {formatDuration(s.expectedMinutes)}</span>
                </span>
                <CheckOutButton studentId={s.studentId} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {present.length} {present.length === 1 ? 'student' : 'students'} present
          </h1>
          <p className="text-sm text-muted-foreground">{centreName}</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search present students…"
            className="max-w-xs"
            aria-label="Search present students"
          />
          <Button type="button" onClick={() => setCheckingIn(true)}>
            Check in
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground">
          {present.length === 0 ? 'Nobody is checked in right now.' : 'No student matches that search.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((s) => (
            <StudentCard key={s.studentId} student={s} onMessage={() => setMessageTarget(s)} />
          ))}
        </div>
      )}

      {checkingIn ? (
        <CheckInDialog students={notPresent} onClose={() => setCheckingIn(false)} />
      ) : null}

      {messageTarget ? (
        <MessageDialog student={messageTarget} centreName={centreName} onClose={() => setMessageTarget(null)} />
      ) : null}
    </div>
  );
}

function CheckOutButton({ studentId, size = 'sm' }: { studentId: string; size?: 'sm' | 'lg' }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          await staffCheckOutAction(fd);
          router.refresh();
        })
      }
    >
      <input type="hidden" name="studentId" value={studentId} />
      <Button type="submit" size={size} disabled={pending} variant="default">
        {pending ? 'Checking out…' : 'Check out'}
      </Button>
    </form>
  );
}

function StudentCard({ student, onMessage }: { student: FloorCard; onMessage: () => void }) {
  const now = useNow();
  const minutes = now === null ? 0 : Math.max(0, (now - student.checkInAtMs) / 60_000);
  const tone = now === null ? 'normal' : elapsedTone(minutes, student.expectedMinutes);

  return (
    <Card
      className={cn(
        'flex flex-col gap-2 p-4 transition-colors',
        tone === 'amber' && 'border-amber-300 bg-amber-50',
        tone === 'red' && 'border-2 border-red-400 bg-red-50',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-lg font-semibold leading-tight">
          {student.firstName} {student.lastInitial}.
        </p>
        <Elapsed
          startedAtMs={student.checkInAtMs}
          expectedMinutes={student.expectedMinutes}
          className="text-lg font-semibold"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {student.subjects.map((s) => (
          <Badge key={s} variant="secondary">
            {s}
          </Badge>
        ))}
      </div>
      {/* The number the timer above is being judged against. 30 minutes per subject,
          set at import — without it the colour change has no visible cause. */}
      <p className="text-xs text-muted-foreground">
        {formatDuration(student.expectedMinutes)} allowed
        {student.pastClose ? ' · still here after closing' : ''}
      </p>

      <div className="mt-auto flex items-center gap-2 pt-2">
        <CheckOutButton studentId={student.studentId} />
        <Button type="button" size="sm" variant="outline" onClick={onMessage}>
          Message
        </Button>
      </div>
    </Card>
  );
}
