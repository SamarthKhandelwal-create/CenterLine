'use client';

import { useEffect } from 'react';

/**
 * The kiosk is student-facing, so a failure must not show a stack trace or a
 * developer message to a child. Same amber screen as any other problem, and it
 * recovers itself so the tablet does not need staff attention.
 */
export default function KioskError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error('[centerline:kiosk]', error);
    const id = setTimeout(() => window.location.reload(), 5000);
    return () => clearTimeout(id);
  }, [error]);

  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="flex min-h-screen w-full flex-col items-center justify-center gap-6 bg-amber-500 p-8 text-center text-white"
    >
      <p className="text-7xl font-bold">Please see the front desk</p>
    </button>
  );
}
