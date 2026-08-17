'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  createStudentAction,
  updateStudentAction,
  type StudentFormState,
} from './actions';

export type StudentFormValues = {
  id?: string;
  firstName: string;
  lastInitial: string;
  subjects: string[];
  expectedMinutes: number | null;
  status: 'active' | 'inactive';
  releaseMode: 'guardian_pickup' | 'self_release';
  guardianName: string | null;
  guardianPhone: string | null;
  smsConsent: boolean;
};

export function StudentForm({ initial }: { initial?: StudentFormValues }) {
  const router = useRouter();
  const isEdit = Boolean(initial?.id);
  const action = isEdit ? updateStudentAction : createStudentAction;
  const [state, formAction, pending] = useActionState<StudentFormState, FormData>(action, {});

  useEffect(() => {
    if (state.ok) router.push('/students');
  }, [state.ok, router]);

  return (
    <Card className="max-w-2xl">
      <CardContent className="pt-6">
        <form action={formAction} className="space-y-5">
          {initial?.id ? <input type="hidden" name="studentId" value={initial.id} /> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="firstName">First name</Label>
              <Input id="firstName" name="firstName" defaultValue={initial?.firstName} required maxLength={80} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastInitial">Last initial</Label>
              <Input
                id="lastInitial"
                name="lastInitial"
                defaultValue={initial?.lastInitial}
                required
                maxLength={1}
                className="uppercase"
              />
              <p className="text-xs text-muted-foreground">
                Only the initial is stored — the kiosk never shows a full surname.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="subjects">Subjects</Label>
            <Input
              id="subjects"
              name="subjects"
              defaultValue={initial?.subjects.join(', ')}
              placeholder="Math, Reading"
            />
            <p className="text-xs text-muted-foreground">Comma separated.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="expectedMinutes">Expected minutes</Label>
              <Input
                id="expectedMinutes"
                name="expectedMinutes"
                type="number"
                min={5}
                max={480}
                defaultValue={initial?.expectedMinutes ?? ''}
                placeholder="30 per subject"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <select
                id="status"
                name="status"
                defaultValue={initial?.status ?? 'active'}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="releaseMode">Release</Label>
              <select
                id="releaseMode"
                name="releaseMode"
                defaultValue={initial?.releaseMode ?? 'guardian_pickup'}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="guardian_pickup">Guardian pickup</option>
                <option value="self_release">Self release</option>
              </select>
            </div>
          </div>

          <fieldset className="space-y-4 rounded-lg border p-4">
            <legend className="px-1 text-sm font-medium">Primary guardian</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="guardianName">Name</Label>
                <Input id="guardianName" name="guardianName" defaultValue={initial?.guardianName ?? ''} maxLength={120} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="guardianPhone">Phone</Label>
                <Input
                  id="guardianPhone"
                  name="guardianPhone"
                  type="tel"
                  defaultValue={initial?.guardianPhone ?? ''}
                  placeholder="+13125550123"
                  maxLength={40}
                />
              </div>
            </div>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                name="smsConsent"
                defaultChecked={initial?.smsConsent}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                This guardian has agreed to receive text messages.
                <span className="block text-xs text-muted-foreground">
                  Recorded with a timestamp. No messages are ever sent without it.
                </span>
              </span>
            </label>
          </fieldset>

          {state.error ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {state.error}
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Add student'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => router.push('/students')}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
