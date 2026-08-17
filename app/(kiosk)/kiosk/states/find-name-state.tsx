'use client';

import { useMemo, useRef } from 'react';
import type { RosterEntry } from '../kiosk-shell';

/**
 * Grid of large tiles. Students currently present sort first (they are the ones
 * about to check out), then alphabetical. No text entry anywhere — an A-Z jump bar
 * instead, because a five-year-old should not have to spell.
 *
 * A green tile checks that student OUT; a white one checks them in. The toggle has
 * always worked this way, but the tiles never said which they would do, so a student
 * leaving had no way to tell this was also the way out. The tap is still the action —
 * no confirmation step, deliberately.
 */
export function FindNameState({
  roster,
  presentIds,
  onSelect,
  onCancel,
}: {
  roster: RosterEntry[];
  presentIds: string[];
  onSelect: (student: RosterEntry) => void;
  onCancel: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const present = useMemo(() => new Set(presentIds), [presentIds]);

  const sorted = useMemo(() => {
    const byName = (a: RosterEntry, b: RosterEntry) =>
      a.firstName.localeCompare(b.firstName) || a.lastInitial.localeCompare(b.lastInitial);
    const here = roster.filter((s) => present.has(s.id)).sort(byName);
    const rest = roster.filter((s) => !present.has(s.id)).sort(byName);
    return [...here, ...rest];
  }, [roster, present]);

  const letters = useMemo(() => {
    const set = new Set(sorted.map((s) => s.firstName[0]?.toUpperCase() ?? '#'));
    return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter((l) => set.has(l));
  }, [sorted]);

  const jumpTo = (letter: string) => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-letter="${letter}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const seen = new Set<string>();

  return (
    <div className="flex min-h-screen flex-col bg-slate-900 text-white">
      <div className="flex items-center justify-between gap-4 p-6">
        <div>
          <h1 className="text-4xl font-bold">Find your name</h1>
          <p className="mt-1 text-xl text-slate-400">
            Green means you are here — tap to check out
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

      <div className="flex flex-1 gap-3 overflow-hidden px-6 pb-6">
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {sorted.map((s) => {
              const letter = s.firstName[0]?.toUpperCase() ?? '#';
              const isFirstOfLetter = !present.has(s.id) && !seen.has(letter);
              if (!present.has(s.id)) seen.add(letter);
              const here = present.has(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  data-letter={isFirstOfLetter ? letter : undefined}
                  onClick={() => onSelect(s)}
                  className={`min-h-[88px] rounded-xl px-4 py-4 text-3xl font-bold active:scale-[0.98] ${
                    here ? 'bg-emerald-500 text-white' : 'bg-white text-slate-900'
                  }`}
                >
                  {s.firstName} {s.lastInitial}.
                  <span
                    className={`mt-1 block text-lg font-semibold ${
                      here ? 'text-emerald-50' : 'text-slate-500'
                    }`}
                  >
                    {here ? 'Check out' : 'Check in'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex w-16 shrink-0 flex-col gap-1 overflow-y-auto">
          {letters.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => jumpTo(l)}
              className="min-h-[44px] rounded-lg bg-slate-700 text-2xl font-bold text-white"
            >
              {l}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
