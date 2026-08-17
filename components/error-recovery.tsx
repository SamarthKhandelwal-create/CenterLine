'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

/**
 * A Server Action id is content-hashed, so a tab left open across a deploy posts an id
 * the new server does not recognise. React surfaces that as a bare "client-side
 * exception", which tells an instructor nothing. Detect it and say the one useful
 * thing: reload.
 */
function isStaleDeployment(error: Error & { digest?: string }): boolean {
  const text = `${error.message} ${error.digest ?? ''}`;
  return (
    /server action/i.test(text) ||
    /Failed to find Server Action/i.test(text) ||
    /older or newer deployment/i.test(text) ||
    // React minifies these in production; 418/423 are the hydration/render pair.
    /Minified React error #(418|423|425)/.test(text)
  );
}

export function ErrorRecovery({
  error,
  reset,
  scope = 'page',
}: {
  error: Error & { digest?: string };
  reset?: () => void;
  scope?: 'page' | 'root';
}) {
  const stale = isStaleDeployment(error);

  useEffect(() => {
    console.error(`[centerline:${scope}]`, error);
  }, [error, scope]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border bg-background p-6 text-center">
        <h1 className="text-lg font-semibold">
          {stale ? 'Centerline was updated' : 'Something went wrong'}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {stale
            ? 'This page was loaded before the update. Reload to get the current version — nothing was lost, and no attendance record is affected.'
            : 'That screen failed to load. Attendance records are unaffected; try again, and if it keeps happening reload the page.'}
        </p>

        <div className="mt-5 flex justify-center gap-2">
          <Button type="button" onClick={() => window.location.reload()}>
            Reload
          </Button>
          {reset && !stale ? (
            <Button type="button" variant="outline" onClick={reset}>
              Try again
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={() => window.location.assign('/floor')}>
            Go to floor
          </Button>
        </div>

        {error.digest ? (
          <p className="mt-4 font-mono text-xs text-muted-foreground">ref {error.digest}</p>
        ) : null}
      </div>
    </div>
  );
}
