'use client';

import { createContext, useContext, useEffect, useState } from 'react';

/**
 * ONE interval for the whole page. Every elapsed timer subscribes to this tick
 * rather than owning a setInterval, so a floor with 40 cards still has exactly one
 * timer running. Paused while the tab is hidden, and resynced on return so a tablet
 * woken after an hour shows the right time immediately rather than drifting.
 */
const TickContext = createContext<number | null>(null);

export function TickProvider({
  children,
  intervalMs = 10_000,
}: {
  children: React.ReactNode;
  intervalMs?: number;
}) {
  // null until mounted: the server cannot know the client's clock, and rendering a
  // server-computed elapsed value would hydration-mismatch on every load.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    let id: ReturnType<typeof setInterval> | undefined;

    const start = () => {
      stop();
      id = setInterval(() => setNow(Date.now()), intervalMs);
    };
    const stop = () => {
      if (id) clearInterval(id);
      id = undefined;
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        setNow(Date.now());
        start();
      }
    };

    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs]);

  return <TickContext.Provider value={now}>{children}</TickContext.Provider>;
}

/** Current time in ms, or null before mount. */
export function useNow(): number | null {
  return useContext(TickContext);
}
