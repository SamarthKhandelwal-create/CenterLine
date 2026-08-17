'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SAVED_TEMPLATES, fillTemplate } from '@/lib/sms/templates';
import { sendManualMessageAction, type ManualMessageState } from './actions';
import type { FloorCard } from './floor-board';

export function MessageDialog({
  student,
  centreName,
  onClose,
}: {
  student: FloorCard;
  centreName: string;
  onClose: () => void;
}) {
  const [body, setBody] = useState('');
  const [state, formAction, pending] = useActionState<ManualMessageState, FormData>(
    sendManualMessageAction,
    {},
  );
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (state.ok) {
      const id = setTimeout(() => closeRef.current(), 900);
      return () => clearTimeout(id);
    }
  }, [state.ok]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const noConsent = student.guardian && !student.guardian.smsConsent;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Message the guardian of ${student.firstName}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-lg border bg-background p-5 shadow-lg">
        <div className="mb-3">
          <h2 className="text-lg font-semibold">
            Message {student.firstName} {student.lastInitial}.&rsquo;s guardian
          </h2>
          {student.guardian ? (
            <p className="text-sm text-muted-foreground">
              {student.guardian.name} · {student.guardian.phone}{' '}
              {noConsent ? <Badge variant="red">No SMS consent</Badge> : null}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No guardian on file.</p>
          )}
        </div>

        <div className="mb-3 flex flex-wrap gap-2">
          {SAVED_TEMPLATES.map((t) => (
            <Button
              key={t.id}
              type="button"
              size="sm"
              variant="secondary"
              onClick={() =>
                setBody(
                  fillTemplate(t.body, { first_name: student.firstName, centre_name: centreName }),
                )
              }
            >
              {t.label}
            </Button>
          ))}
        </div>

        <form action={formAction} className="space-y-3">
          <input type="hidden" name="studentId" value={student.studentId} />
          <textarea
            name="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            maxLength={320}
            required
            placeholder="Write a message…"
            className="w-full rounded-md border border-input bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{body.length}/320</span>
            <span>No emoji — they double the cost of a message.</span>
          </div>

          {state.error ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {state.error}
            </p>
          ) : null}
          {state.ok ? <p className="text-sm font-medium text-emerald-700">{state.info}</p> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !!noConsent || !student.guardian}>
              {pending ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
