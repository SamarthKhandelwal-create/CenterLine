'use client';

import { useMemo } from 'react';
import { formatLocalTime } from '@/lib/time/centre-time';
import type { StaffEntry } from '../kiosk-shell';

/**
 * Staff clock in / out, on the tablet by the door.
 *
 * Deliberately the same shape as the student name grid: people on shift sort first and
 * are green, one tap is the action, and the tile says which way it goes. Staff use this
 * screen at the same door, in the same thirty seconds, as everybody else.
 *
 * The one visible difference is the header, which names the screen as a staff one — a
 * child who wanders in here should be able to tell straight away that it is not for them,
 * and Back is a full-size target rather than something to hunt for.
 */
export function StaffShiftState({
  staff,
  timezone,
  onSelect,
  onCancel,
}: {
  staff: StaffEntry[];
  timezone: string;
  onSelect: (person: StaffEntry) => void;
  onCancel: () => void;
}) {
  const sorted = useMemo(() => {
    const byName = (a: StaffEntry, b: StaffEntry) => a.name.localeCompare(b.name);
    const onShift = staff.filter((s) => s.onShiftSinceMs !== null).sort(byName);
    const off = staff.filter((s) => s.onShiftSinceMs === null).sort(byName);
    return [...onShift, ...off];
  }, [staff]);

  return (
    <div className="flex min-h-screen flex-col bg-slate-900 text-white">
      <div className="flex items-center justify-between gap-4 p-6">
        <div>
          <h1 className="text-4xl font-bold">Staff — clock in or out</h1>
          <p className="mt-1 text-xl text-slate-400">
            Green means you are on shift — tap to clock out
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[88px] min-w-[160px] rounded-xl border-4 border-white px-6 text-3xl font-bold"
        >
          Back
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {sorted.length === 0 ? (
          <p className="py-16 text-center text-2xl text-slate-400">
            Nobody is on this centre&rsquo;s staff list yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sorted.map((person) => {
              const onShift = person.onShiftSinceMs !== null;
              return (
                <button
                  key={person.id}
                  type="button"
                  onClick={() => onSelect(person)}
                  className={`min-h-[110px] rounded-xl px-4 py-4 text-3xl font-bold active:scale-[0.98] ${
                    onShift ? 'bg-emerald-500 text-white' : 'bg-white text-slate-900'
                  }`}
                >
                  {person.name}
                  <span
                    className={`mt-1 block text-lg font-semibold ${
                      onShift ? 'text-emerald-50' : 'text-slate-500'
                    }`}
                  >
                    {onShift
                      ? `Clock out · in since ${formatLocalTime(
                          new Date(person.onShiftSinceMs!),
                          timezone,
                        )}`
                      : 'Clock in'}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
