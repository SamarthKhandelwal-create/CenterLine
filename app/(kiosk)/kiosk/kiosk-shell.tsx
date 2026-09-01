'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useBarcodeScanner } from '@/hooks/use-barcode-scanner';
import { IdleState } from './states/idle-state';
import { FindNameState } from './states/find-name-state';
import { StaffShiftState } from './states/staff-shift-state';
import { ResultState } from './states/result-state';

export type RosterEntry = { id: string; firstName: string; lastInitial: string };

/** A member of staff and whether they are on shift. Names only — see staffShiftStatus. */
export type StaffEntry = { id: string; name: string; onShiftSinceMs: number | null };

export type KioskResult =
  | {
      kind: 'success';
      action: 'check_in' | 'check_out';
      firstName: string;
      lastInitial: string;
      occurredAt: string;
      durationMinutes: number | null;
      /** The 20-second grace window replayed the previous result; nothing was recorded. */
      repeated: boolean;
    }
  | {
      /**
       * The kiosk refused to check them out: their session has not run long enough.
       * Nothing was recorded — this screen IS the outcome.
       */
      kind: 'tooEarly';
      firstName: string;
      lastInitial: string;
    }
  | {
      kind: 'staff';
      action: 'clock_in' | 'clock_out';
      name: string;
      occurredAt: string;
      durationMinutes: number | null;
    }
  | { kind: 'error' };

type State =
  | { screen: 'idle' }
  | { screen: 'findName' }
  | { screen: 'staff' }
  | { screen: 'resolving' }
  | { screen: 'result'; result: KioskResult };

type Action =
  | { type: 'openFindName' }
  | { type: 'openStaff' }
  | { type: 'resolving' }
  | { type: 'result'; result: KioskResult }
  | { type: 'idle' };

const RESULT_MS = 2500;
/**
 * The "not yet" screen asks the child to go and do something, so it stays up longer than
 * a result they only have to read. Still auto-dismisses: a tablet holding one child's
 * refusal is a tablet the next child in the queue cannot use.
 */
const BLOCKED_RESULT_MS = 6000;
const INACTIVITY_MS = 20_000;
const RESOLVE_TIMEOUT_MS = 8000;

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'openFindName':
      return { screen: 'findName' };
    case 'openStaff':
      return { screen: 'staff' };
    case 'resolving':
      return { screen: 'resolving' };
    case 'result':
      return { screen: 'result', result: action.result };
    case 'idle':
      return { screen: 'idle' };
    default:
      return state;
  }
}

type ApiResponse = {
  ok: boolean;
  action?: string;
  firstName?: string;
  lastInitial?: string;
  name?: string;
  occurredAt?: string;
  durationMinutes?: number | null;
  repeated?: boolean;
  /** Not ok, but not a failure either — see KioskResult['kind'] === 'tooEarly'. */
  tooEarly?: boolean;
};

export function KioskShell({
  centreName,
  timezone,
  roster,
  presentIds,
  staff,
}: {
  centreName: string;
  timezone: string;
  roster: RosterEntry[];
  presentIds: string[];
  /** Null on a tablet that was not put into kiosk mode by an instructor. */
  staff: StaffEntry[] | null;
}) {
  const [state, dispatch] = useReducer(reducer, { screen: 'idle' });
  const router = useRouter();
  const busyRef = useRef(false);

  const post = useCallback(async (path: string, payload: unknown): Promise<ApiResponse | null> => {
    // 'resolving' is a real state, not a flag, so a second scan mid-request cannot
    // fire a second POST. The DB transaction is the backstop; this is the UI guard.
    if (busyRef.current) return null;
    busyRef.current = true;
    dispatch({ type: 'resolving' });
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return (await res.json().catch(() => null)) as ApiResponse | null;
    } catch {
      return null;
    } finally {
      busyRef.current = false;
    }
  }, []);

  const submit = useCallback(
    async (path: string, payload: unknown) => {
      const data = await post(path, payload);

      if (data && !data.ok && data.tooEarly && data.firstName) {
        dispatch({
          type: 'result',
          result: {
            kind: 'tooEarly',
            firstName: data.firstName,
            lastInitial: data.lastInitial ?? '',
          },
        });
        return true;
      }

      if (data?.ok && data.firstName && (data.action === 'check_in' || data.action === 'check_out')) {
        dispatch({
          type: 'result',
          result: {
            kind: 'success',
            action: data.action,
            firstName: data.firstName,
            lastInitial: data.lastInitial ?? '',
            occurredAt: data.occurredAt ?? new Date().toISOString(),
            durationMinutes: data.durationMinutes ?? null,
            repeated: data.repeated ?? false,
          },
        });
        router.refresh();
        return true;
      }
      return false;
    },
    [post, router],
  );

  const onScan = useCallback(
    async (token: string) => {
      const ok = await submit('/api/kiosk/scan', { token });
      if (!ok) dispatch({ type: 'result', result: { kind: 'error' } });
    },
    [submit],
  );

  const onSelectStudent = useCallback(
    async (student: RosterEntry) => {
      // Tapping the name IS the check-in. No PIN, no confirmation step.
      const ok = await submit('/api/kiosk/tap', { studentId: student.id });
      if (!ok) dispatch({ type: 'result', result: { kind: 'error' } });
    },
    [submit],
  );

  const onSelectStaff = useCallback(
    async (person: StaffEntry) => {
      // Same toggle as a student tap: the tablet works out whether this is the start or
      // the end of the shift, so there is one button per person rather than two.
      const data = await post('/api/kiosk/staff', { userId: person.id });

      if (data?.ok && data.name && (data.action === 'clock_in' || data.action === 'clock_out')) {
        dispatch({
          type: 'result',
          result: {
            kind: 'staff',
            action: data.action,
            name: data.name,
            occurredAt: data.occurredAt ?? new Date().toISOString(),
            durationMinutes: data.durationMinutes ?? null,
          },
        });
        router.refresh();
        return;
      }
      dispatch({ type: 'result', result: { kind: 'error' } });
    },
    [post, router],
  );

  // The scanner is live in every state, including the result screen — children queue
  // and scan back to back, and the next scan should pre-empt the 2.5s countdown.
  useBarcodeScanner(onScan, true);

  // Result auto-dismiss.
  useEffect(() => {
    if (state.screen !== 'result') return;
    const ms = state.result.kind === 'tooEarly' ? BLOCKED_RESULT_MS : RESULT_MS;
    const id = setTimeout(() => dispatch({ type: 'idle' }), ms);
    return () => clearTimeout(id);
  }, [state.screen, state]);

  // Watchdog: a hung request must never leave a child staring at "One moment…".
  // Whatever went wrong, they get the same amber "see the front desk" screen.
  useEffect(() => {
    if (state.screen !== 'resolving') return;
    const id = setTimeout(() => {
      busyRef.current = false;
      dispatch({ type: 'result', result: { kind: 'error' } });
    }, RESOLVE_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [state.screen]);

  // Inactivity return to idle, so a child who walks away mid-flow leaves a clean screen.
  // The staff list gets the same treatment for a stronger reason: a list of names with
  // live Clock out buttons is the last thing that should sit on an unattended tablet.
  useEffect(() => {
    if (state.screen !== 'findName' && state.screen !== 'staff') return;
    const id = setTimeout(() => dispatch({ type: 'idle' }), INACTIVITY_MS);
    return () => clearTimeout(id);
  }, [state.screen]);

  switch (state.screen) {
    case 'idle':
      return (
        <IdleState
          centreName={centreName}
          timezone={timezone}
          onFindName={() => dispatch({ type: 'openFindName' })}
          onStaffShifts={staff ? () => dispatch({ type: 'openStaff' }) : null}
        />
      );
    case 'findName':
      return (
        <FindNameState
          roster={roster}
          presentIds={presentIds}
          onSelect={onSelectStudent}
          onCancel={() => dispatch({ type: 'idle' })}
        />
      );
    case 'staff':
      return (
        <StaffShiftState
          staff={staff ?? []}
          timezone={timezone}
          onSelect={onSelectStaff}
          onCancel={() => dispatch({ type: 'idle' })}
        />
      );
    case 'resolving':
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-900">
          <p className="text-4xl font-semibold text-white">One moment…</p>
        </div>
      );
    case 'result':
      return (
        <ResultState
          result={state.result}
          timezone={timezone}
          onDismiss={() => dispatch({ type: 'idle' })}
        />
      );
  }
}
