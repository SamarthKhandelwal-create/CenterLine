'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { attestAction, type AttestState } from './actions';

/** Records the annual certification for a requirement staff confirm by hand. */
export function AttestForm({
  requirementId,
  title,
  renewing,
}: {
  requirementId: string;
  title: string;
  renewing: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<AttestState, FormData>(attestAction, {});

  if (!open) {
    return (
      <div className="mt-2 flex items-center gap-3">
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
          {renewing ? 'Renew confirmation' : 'Confirm this requirement'}
        </Button>
        {state.ok ? <span className="text-sm text-emerald-700">Recorded.</span> : null}
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-2 space-y-2 rounded-md border bg-muted/30 p-3">
      <input type="hidden" name="requirementId" value={requirementId} />
      <label className="block text-sm font-medium" htmlFor={`note-${requirementId}`}>
        How does your centre meet this? <span className="font-normal text-muted-foreground">(optional)</span>
      </label>
      <Input
        id={`note-${requirementId}`}
        name="note"
        maxLength={400}
        placeholder={
          requirementId === 'backup-preservation'
            ? 'e.g. weekly CSV backup saved to the centre laptop and printed emergency roster kept at the desk'
            : 'e.g. all assistants walked through the kiosk process at the start of term'
        }
      />
      <p className="text-xs text-muted-foreground">
        Recording this confirms, as of today, that “{title}” is met. It is valid for twelve months
        and is added to the record rather than replacing last year’s confirmation.
      </p>
      {state.error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {state.error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Recording…' : 'Confirm'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
