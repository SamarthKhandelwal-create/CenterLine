'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * Opens the print dialog only when reached as /emergency?print=1, so the drill can be
 * one tap from a shortcut without ambushing anyone who just opens the page to look.
 */
export function AutoPrint() {
  const params = useSearchParams();
  const shouldPrint = params.get('print') === '1';

  useEffect(() => {
    if (!shouldPrint) return;
    const id = setTimeout(() => window.print(), 400);
    return () => clearTimeout(id);
  }, [shouldPrint]);

  return null;
}
