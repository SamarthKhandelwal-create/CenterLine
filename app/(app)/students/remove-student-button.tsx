'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { removeStudentAction } from './actions';

/**
 * Two-step, and the second step names the consequence rather than asking "are you
 * sure?". Which of the two happens is decided by the server from the attendance log,
 * so this only warns — it never predicts, and it never sends a "delete" instruction
 * that the server could take at face value.
 */
export function RemoveStudentButton({
  studentId,
  name,
  status,
}: {
  studentId: string;
  name: string;
  status: 'active' | 'inactive';
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      setError(null);
      const body = new FormData();
      body.set('studentId', studentId);
      const result = await removeStudentAction(body);
      if (result.error) {
        setError(result.error);
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="text-destructive hover:bg-destructive/10"
        onClick={() => setConfirming(true)}
        // An already-inactive student is off the roster; removing again does nothing
        // a person would notice, so the button stays out of the way.
        disabled={status === 'inactive'}
      >
        Remove
      </Button>
    );
  }

  return (
    <span className="flex flex-wrap items-center justify-end gap-2">
      <span className="text-xs text-muted-foreground">
        Remove {name}? If they have any attendance record they are made inactive, not
        deleted — the log is kept.
      </span>
      <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={run}>
        {pending ? 'Removing…' : 'Remove'}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => setConfirming(false)}
      >
        Cancel
      </Button>
      {error ? (
        <span role="alert" className="w-full text-xs font-medium text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}
