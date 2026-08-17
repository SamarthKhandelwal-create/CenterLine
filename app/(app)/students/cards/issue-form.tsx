'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { issueCardsAction, type IssueState } from './actions';

export function IssueCardsForm({ count }: { count: number }) {
  const [state, formAction, pending] = useActionState<IssueState, FormData>(issueCardsAction, {});

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (
          !confirm(
            `Issue new cards for all ${count} active students?\n\nEvery card printed before now will stop working immediately.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? 'Issuing…' : 'Issue new cards'}
      </Button>
      {state.error ? <p className="mt-1 text-sm text-destructive">{state.error}</p> : null}
    </form>
  );
}
