'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { clockOutAction } from '../floor/shift-actions';

/** Closes a shift somebody left open. Recorded as ended by the instructor who did it. */
export function CloseShiftButton({ shiftId }: { shiftId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form
      action={(fd) =>
        start(async () => {
          await clockOutAction(fd);
          router.refresh();
        })
      }
    >
      <input type="hidden" name="shiftId" value={shiftId} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? 'Closing…' : 'Close shift'}
      </Button>
    </form>
  );
}
