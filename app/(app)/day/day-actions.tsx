'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { confirmAllInferredAction, confirmInferredAction } from './actions';
import { staffCheckOutAction } from '../floor/actions';

export function ConfirmButton({ eventId }: { eventId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form
      action={(fd) =>
        start(async () => {
          await confirmInferredAction(fd);
          router.refresh();
        })
      }
    >
      <input type="hidden" name="eventId" value={eventId} />
      <Button type="submit" disabled={pending} variant="success">
        {pending ? 'Confirming…' : 'Confirm'}
      </Button>
    </form>
  );
}

/**
 * Confirms a whole section at once.
 *
 * Two presses, not one. Confirming an estimate is an attestation that a person checked
 * the record, and a single mis-click doing that to a whole day's students is the one
 * mistake this screen must not make easy — the second press is where the count is read
 * back. Individual Confirm stays one press, because it is one record.
 */
export function ConfirmAllButton({ eventIds, label }: { eventIds: string[]; label: string }) {
  const [pending, start] = useTransition();
  const [armed, setArmed] = useState(false);
  const router = useRouter();

  if (!armed) {
    return (
      <Button type="button" variant="outline" onClick={() => setArmed(true)}>
        Confirm all ({eventIds.length})
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-amber-900">Confirm {label}?</span>
      <form
        action={(fd) =>
          start(async () => {
            await confirmAllInferredAction(fd);
            setArmed(false);
            router.refresh();
          })
        }
      >
        {eventIds.map((id) => (
          <input key={id} type="hidden" name="eventId" value={id} />
        ))}
        <Button type="submit" disabled={pending} variant="success">
          {pending ? 'Confirming…' : `Yes, confirm ${eventIds.length}`}
        </Button>
      </form>
      <Button type="button" variant="ghost" disabled={pending} onClick={() => setArmed(false)}>
        Cancel
      </Button>
    </div>
  );
}

export function CheckOutNowButton({ studentId }: { studentId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form
      action={(fd) =>
        start(async () => {
          await staffCheckOutAction(fd);
          router.refresh();
        })
      }
    >
      <input type="hidden" name="studentId" value={studentId} />
      <Button type="submit" disabled={pending}>
        {pending ? 'Checking out…' : 'Check out'}
      </Button>
    </form>
  );
}
