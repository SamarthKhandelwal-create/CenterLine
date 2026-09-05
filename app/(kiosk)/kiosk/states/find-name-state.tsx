'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { RosterEntry } from '../kiosk-shell';

/**
 * Grid of large tiles. Students currently present sort first (they are the ones
 * about to check out), then alphabetical. The default path is still no text entry —
 * an A-Z jump bar, because a five-year-old should not have to spell.
 *
 * Search is the deliberate exception, and it is opt-in: closed by default, opened by a
 * button, and closing it restores the full grid. It is there for the adult standing at
 * the tablet — a member of staff checking a child in on a busy afternoon, a parent who
 * knows the name — not for the child, who still has the jump bar. Making it a button
 * rather than an always-visible field is the whole point: nothing on the screen asks a
 * five-year-old to type.
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
  const [searching, setSearching] = useState(false);
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

  // The on-screen keyboard is the reason the button exists, so opening it should not
  // then require a second tap on the field itself.
  useEffect(() => {
    if (searching) inputRef.current?.focus();
  }, [searching]);

  const closeSearch = () => {
    setSearching(false);
    setQuery('');
  };

  const jumpTo = (letter: string) => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-letter="${letter}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const seen = new Set<string>();

  return (
    <div className="flex min-h-screen flex-col bg-slate-900 text-white">
      <div className="flex items-center justify-between gap-4 p-6">
        {searching ? (
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              onActivity();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') closeSearch();
            }}
            placeholder="Type a name"
            autoComplete="off"
            aria-label="Search for a student by name"
            className="min-h-[88px] flex-1 rounded-xl bg-white px-6 text-4xl font-bold text-slate-900 placeholder:font-semibold placeholder:text-slate-400"
          />
        ) : (
          <div>
            <h1 className="text-4xl font-bold">Find your name</h1>
            <p className="mt-1 text-xl text-slate-400">
              Green means you are here — tap to check out
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            onActivity();
            if (searching) closeSearch();
            else setSearching(true);
          }}
          className="min-h-[88px] min-w-[160px] rounded-xl border-4 border-slate-600 px-6 text-3xl font-bold text-slate-200 active:scale-[0.98] hover:border-slate-400 hover:text-white"
        >
          {searching ? 'Clear' : 'Search'}
        </button>

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
            most of them are no longer on screen. It comes back when search is closed. */}
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
