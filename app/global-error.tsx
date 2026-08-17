'use client';

import { ErrorRecovery } from '@/components/error-recovery';
import './globals.css';

/** Last resort: catches failures in the root layout itself, so it ships its own html. */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <ErrorRecovery error={error} scope="root" />
      </body>
    </html>
  );
}
