'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { confirmInferredAction } from './actions';
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
