'use client';

import { useMemo, useRef, useState } from 'react';
import type { RosterEntry } from '../kiosk-shell';

/**
 * Grid of large tiles. Students currently present sort first (they are the ones
 * about to check out), then alphabetical.
 *
 * A permanently visible search field sits above the grid, for the adult standing at the
 * tablet — a member of staff checking a child in on a busy afternoon, a parent who knows
 * the name. It is not the child's path: tapping a tile is, and the A-Z jump bar is there
 * so a five-year-old never has to spell their own name to reach one.
 *
 * Three things keep the field from taking the screen over. It does not autofocus, so it
 * never raises a keyboard over the tiles unasked. Clear only appears once something has
 * been typed. And an empty field filters nothing — the full roster is what a child sees
 * on arrival, exactly as before.
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
  onActivity,
  onCancel,
}: {
  roster: RosterEntry[];
  presentIds: string[];
  onSelect: (student: RosterEntry) => void;
  /** Restarts the shell's 20s inactivity timer — see the note on it in KioskShell. */
  onActivity: () => void;
  onCancel: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const present = useMemo(() => new Set(presentIds), [presentIds]);

  const sorted = useMemo(() => {
    const byName = (a: RosterEntry, b: RosterEntry) =>
      a.firstName.localeCompare(b.firstName) || a.lastInitial.localeCompare(b.lastInitial);
    const here = roster.filter((s) => present.has(s.id)).sort(byName);
    const rest = roster.filter((s) => !present.has(s.id)).sort(byName);
    return [...here, ...rest];
  }, [roster, present]);

  // Matches "Sam", "K", or "Sam K" — first name, last initial, or both. Typing a
  // space is what a staff member does to separate the two Sams, so it has to work.
  const trimmed = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!trimmed) return sorted;
    return sorted.filter((s) => {
      const full = `${s.firstName} ${s.lastInitial}`.toLowerCase();
      return (
        s.firstName.toLowerCase().startsWith(trimmed) ||
        s.lastInitial.toLowerCase().startsWith(trimmed) ||
        full.startsWith(trimmed)
      );
    });
  }, [sorted, trimmed]);

  const letters = useMemo(() => {
    const set = new Set(sorted.map((s) => s.firstName[0]?.toUpperCase() ?? '#'));
    return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter((l) => set.has(l));
  }, [sorted]);

  // Deliberately NOT autofocused. Focusing on arrival raises the on-screen keyboard over
  // the tile grid for every child who only wants to tap their name — the tiles remain the
  // primary path, and the field waits to be tapped.
  const clearSearch = () => {
    setQuery('');
    inputRef.current?.focus();
  };

  const jumpTo = (letter: string) => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-letter="${letter}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const seen = new Set<string>();

  return (
    <div className="flex min-h-screen flex-col bg-slate-900 text-white">
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-center justify-between gap-4">
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

        <div className="flex items-center gap-4">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              onActivity();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') clearSearch();
            }}
            placeholder="Search for a name"
            autoComplete="off"
            aria-label="Search for a student by name"
            className="min-h-[88px] flex-1 rounded-xl bg-white px-6 text-4xl font-bold text-slate-900 placeholder:font-semibold placeholder:text-slate-400"
          />
          {/* Only rendered once there is something to clear. A permanently visible
              Clear next to an empty field is a button that does nothing. */}
          {query ? (
            <button
              type="button"
              onClick={() => {
                clearSearch();
                onActivity();
              }}
              className="min-h-[88px] min-w-[160px] rounded-xl border-4 border-slate-600 px-6 text-3xl font-bold text-slate-200 active:scale-[0.98] hover:border-slate-400 hover:text-white"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-1 gap-3 overflow-hidden px-6 pb-6">
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {trimmed && matches.length === 0 ? (
            <p className="mt-16 text-center text-3xl font-semibold text-slate-400">
              No name matches “{query.trim()}”
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {matches.map((s) => {
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

        {/* Hidden while filtering: the anchors it jumps to are for the full roster, and
            most of them are no longer on screen. It returns when the field is emptied. */}
        <div
          className={`w-16 shrink-0 flex-col gap-1 overflow-y-auto ${trimmed ? 'hidden' : 'flex'}`}
        >
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
