'use client';

import { useEffect, useRef } from 'react';

/**
 * Confirmation before taking the tablet out of kiosk mode.
 *
 * The confirm step is the only friction on the way out — the exit is unauthenticated by
 * design, so this is what stops a stray press from a child at the door emptying the
 * screen. Big touch targets, and Cancel is the one that looks like the default.
 *
 * Hand-rolled like every other dialog here: there is no shared Dialog primitive and no
 * Radix in this project.
 */
export function ExitPanel({ onCancel }: { onCancel: () => void }) {
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // A child who opens this and wanders off must not leave the door screen sitting on a
  // dialog nobody can read — same reasoning as the find-a-name inactivity timeout.
  useEffect(() => {
    const id = setTimeout(() => cancelRef.current(), 20_000);
    return () => clearTimeout(id);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Exit kiosk mode"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-xl rounded-2xl bg-white p-8 text-slate-900 shadow-xl">
        <h2 className="text-3xl font-bold">Exit kiosk mode?</h2>
        <p className="mt-3 text-xl text-slate-600">
          This tablet will stop checking students in and go back to the staff sign-in screen.
          Setting it up again takes one sign-in.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row-reverse">
          <form method="post" action="/api/kiosk/exit" className="sm:flex-1">
            <button
              type="submit"
              className="min-h-[88px] w-full rounded-xl bg-slate-900 px-6 text-2xl font-bold text-white active:scale-[0.98]"
            >
              Exit kiosk mode
            </button>
          </form>
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[88px] rounded-xl border-4 border-slate-900 px-8 text-2xl font-bold active:scale-[0.98] sm:flex-1"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
