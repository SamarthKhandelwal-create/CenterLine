'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useBarcodeScanner } from '@/hooks/use-barcode-scanner';
import { IdleState } from './states/idle-state';
import { FindNameState } from './states/find-name-state';
import { ResultState } from './states/result-state';

export type RosterEntry = { id: string; firstName: string; lastInitial: string };

export type KioskResult =
  | {
      kind: 'success';
      action: 'check_in' | 'check_out';
      firstName: string;
      lastInitial: string;
      occurredAt: string;
      durationMinutes: number | null;
    }
  | { kind: 'error' };

type State =
  | { screen: 'idle' }
  | { screen: 'findName' }
  | { screen: 'resolving' }
  | { screen: 'result'; result: KioskResult };

type Action =
  | { type: 'openFindName' }
  | { type: 'resolving' }
  | { type: 'result'; result: KioskResult }
  | { type: 'idle' };

const RESULT_MS = 2500;
const INACTIVITY_MS = 20_000;
const RESOLVE_TIMEOUT_MS = 8000;

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'openFindName':
      return { screen: 'findName' };
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

export function KioskShell({
  centreName,
  timezone,
  roster,
  presentIds,
}: {
  centreName: string;
  timezone: string;
  roster: RosterEntry[];
  presentIds: string[];
}) {
  const [state, dispatch] = useReducer(reducer, { screen: 'idle' });
  const router = useRouter();
  const busyRef = useRef(false);

  const submit = useCallback(
    async (path: string, payload: unknown) => {
      // 'resolving' is a real state, not a flag, so a second scan mid-request cannot
      // fire a second POST. The DB transaction is the backstop; this is the UI guard.
      if (busyRef.current) return false;
      busyRef.current = true;
      dispatch({ type: 'resolving' });
      try {
        const res = await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = (await res.json().catch(() => null)) as
          | {
              ok: boolean;
              action?: 'check_in' | 'check_out';
              firstName?: string;
              lastInitial?: string;
              occurredAt?: string;
              durationMinutes?: number | null;
            }
          | null;

        if (data?.ok && data.action && data.firstName) {
          dispatch({
            type: 'result',
            result: {
              kind: 'success',
              action: data.action,
              firstName: data.firstName,
              lastInitial: data.lastInitial ?? '',
              occurredAt: data.occurredAt ?? new Date().toISOString(),
              durationMinutes: data.durationMinutes ?? null,
            },
          });
          router.refresh();
          return true;
        }
        return false;
      } catch {
        return false;
      } finally {
        busyRef.current = false;
      }
    },
    [router],
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

  // The scanner is live in every state, including the result screen — children queue
  // and scan back to back, and the next scan should pre-empt the 2.5s countdown.
  useBarcodeScanner(onScan, true);

  // Result auto-dismiss.
  useEffect(() => {
    if (state.screen !== 'result') return;
    const id = setTimeout(() => dispatch({ type: 'idle' }), RESULT_MS);
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
  useEffect(() => {
    if (state.screen !== 'findName') return;
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
