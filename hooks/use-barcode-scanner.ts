'use client';

import { useEffect, useRef } from 'react';

/**
 * Listens for a barcode scanner in keyboard-wedge mode, at all times, with no
 * focused field required.
 *
 * A scanner emits its whole payload in 10-40ms and ends with Enter. A human types
 * at >60ms between keys. That gap is the discriminator: keys arriving faster than
 * BURST_GAP_MS accumulate into a scan buffer, and an Enter that terminates a
 * long-enough fast burst is a scan.
 *
 * If a field happens to be focused (the PIN pad, the name search), a burst is still
 * captured and preventDefault()'d so the token does not leak into the input.
 */
const BURST_GAP_MS = 60;
const MIN_TOKEN_LENGTH = 8;
const BUFFER_TIMEOUT_MS = 300;

export function useBarcodeScanner(onScan: (token: string) => void, enabled = true) {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    let buffer = '';
    let lastKeyAt = 0;
    let burstStartedAt = 0;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const reset = () => {
      buffer = '';
      burstStartedAt = 0;
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = undefined;
    };

    const armTimeout = () => {
      if (timeoutId) clearTimeout(timeoutId);
      // A partial scan must not concatenate into the next one.
      timeoutId = setTimeout(reset, BUFFER_TIMEOUT_MS);
    };

    const handler = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const now = event.timeStamp || Date.now();
      const gap = now - lastKeyAt;
      const inBurst = gap < BURST_GAP_MS;

      if (event.key === 'Enter') {
        const fastEnough = burstStartedAt > 0 && now - burstStartedAt < 800;
        if (buffer.length >= MIN_TOKEN_LENGTH && fastEnough) {
          const token = buffer;
          reset();
          lastKeyAt = now;
          event.preventDefault();
          event.stopPropagation();
          onScanRef.current(token);
          return;
        }
        reset();
        lastKeyAt = now;
        return;
      }

      if (event.key.length !== 1) {
        lastKeyAt = now;
        return;
      }

      if (!inBurst) {
        // First key of a possible burst. Start a fresh buffer.
        buffer = event.key;
        burstStartedAt = now;
      } else {
        buffer += event.key;
        // Once it is clearly machine-speed, keep the characters out of any input.
        if (buffer.length >= 4) {
          event.preventDefault();
          event.stopPropagation();
        }
      }

      lastKeyAt = now;
      armTimeout();
    };

    document.addEventListener('keydown', handler, { capture: true });
    return () => {
      document.removeEventListener('keydown', handler, { capture: true });
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [enabled]);
}
