'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { StaffCommitResult, StaffImportPlan } from '@/lib/staff/import';

export function StaffImportWizard() {
  const router = useRouter();

  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [plan, setPlan] = useState<StaffImportPlan | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<StaffCommitResult | null>(null);
  const [excluded, setExcluded] = useState<number[]>([]);

  async function onAnalyze() {
    const input = fileRef.current;
    if (!input?.files?.[0]) {
      setAnalyzeError('Choose a CSV or Excel file to import.');
      return;
    }
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const body = new FormData();
      body.set('file', input.files[0]);
      const res = await fetch('/api/staff/import/analyze', { method: 'POST', body });
      const data = (await res.json()) as { plan?: StaffImportPlan; fileName?: string; error?: string };
      if (!res.ok || data.error || !data.plan) {
        setAnalyzeError(data.error ?? 'That file could not be read.');
      } else {
        setPlan(data.plan);
        setFileName(data.fileName ?? input.files[0].name);
      }
    } catch {
      setAnalyzeError('That file could not be uploaded.');
    } finally {
      setAnalyzing(false);
    }
  }

  async function onCommit() {
    if (!plan) return;
    setCommitting(true);
    setCommitError(null);
    try {
      const res = await fetch('/api/staff/import/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan, excluded }),
      });
      const data = (await res.json()) as { result?: StaffCommitResult; error?: string };
      if (!res.ok || data.error || !data.result) {
        setCommitError(data.error ?? 'The import could not be applied.');
      } else {
        setCommitResult(data.result);
        router.refresh();
      }
    } catch {
      setCommitError('The import could not be applied.');
    } finally {
      setCommitting(false);
    }
  }

  if (commitResult) {
    const r = commitResult;
    return (
      <div className="space-y-4">
        <Card className="max-w-3xl">
          <CardContent className="space-y-4 pt-6">
            <h2 className="text-lg font-semibold">Import complete</h2>
            <ul className="space-y-1 text-sm">
              <li>{r.created} accounts created</li>
              <li>{r.updated} updated</li>
              <li>{r.unchanged} unchanged</li>
              {r.skipped > 0 ? <li>{r.skipped} skipped</li> : null}
              {r.blocked > 0 ? <li>{r.blocked} could not be imported</li> : null}
            </ul>
          </CardContent>
        </Card>

        {r.refused.length > 0 ? (
          <section className="max-w-3xl space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-4">
            <h3 className="font-semibold text-amber-900">Some role changes were not applied</h3>
            {r.refused.map((x) => (
              <p key={x.email} className="text-sm text-amber-900">
                {x.email} — {x.reason}
              </p>
            ))}
          </section>
        ) : null}

        {r.newAccounts.length > 0 ? (
          <section className="max-w-3xl space-y-3 rounded-lg border border-emerald-300 bg-emerald-50 p-4">
            <div>
              <h3 className="font-semibold text-emerald-900">
                Temporary passwords — shown once, on this screen only
              </h3>
              <p className="text-sm text-emerald-900">
                Nothing stores these in readable form and this page cannot show them again.
                Write them down or hand them over now; each person should change theirs after
                signing in. If one is lost, the account has to be reset rather than looked up.
              </p>
            </div>
            <ul className="space-y-1">
              {r.newAccounts.map((a) => (
                <li
                  key={a.email}
                  className="flex flex-wrap items-baseline gap-x-3 rounded-md border bg-white px-3 py-2 text-sm"
                >
                  <span className="font-medium">{a.name}</span>
                  <span className="text-muted-foreground">{a.email}</span>
                  <Badge variant="secondary">{a.role}</Badge>
                  <code className="ml-auto rounded bg-muted px-2 py-1 font-mono text-sm">
                    {a.temporaryPassword}
                  </code>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="flex gap-2">
          <Button onClick={() => router.push('/staff')}>Back to staff</Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Import another file
          </Button>
        </div>
      </div>
    );
  }

  if (!plan) {
    return (
      <Card className="max-w-xl">
        <CardContent className="pt-6">
          <div className="space-y-4">
            <input
              ref={fileRef}
              type="file"
              name="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              required
              className="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground"
            />
            <p className="text-xs text-muted-foreground">
              CSV, XLSX or XLS, up to 5 MB. It needs an email column — that is what staff
              are matched on. Name and role are optional. Passwords are never read from a
              file.
            </p>
            {analyzeError ? (
              <p role="alert" className="text-sm font-medium text-destructive">
                {analyzeError}
              </p>
            ) : null}
            <Button type="button" onClick={onAnalyze} disabled={analyzing}>
              {analyzing ? 'Reading file…' : 'Review import'}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { counts } = plan;
  const indexed = plan.items.map((item, index) => ({ item, index }));
  const newItems = indexed.filter(({ item }) => item.action === 'new');
  const updatedItems = indexed.filter(({ item }) => item.action === 'updated');
  const blockedItems = indexed.filter(({ item }) => item.action === 'blocked');
  const toApply = counts.new + counts.updated - excluded.length;

  const toggle = (index: number, checked: boolean) =>
    setExcluded((prev) => (checked ? prev.filter((i) => i !== index) : [...prev, index]));

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 pt-6">
          <Stat label="New accounts" value={counts.new} tone="green" />
          <Stat label="Updated" value={counts.updated} tone="amber" />
          <Stat label="Unchanged" value={counts.unchanged} tone="secondary" />
          {counts.blocked > 0 ? <Stat label="Cannot import" value={counts.blocked} tone="red" /> : null}
          <div className="ml-auto text-sm text-muted-foreground">
            {fileName} · headers found on row {plan.headerRowIndex + 1}
          </div>
        </CardContent>
      </Card>

      {plan.unmappedHeaders.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          Ignored columns: {plan.unmappedHeaders.join(', ')}
        </p>
      ) : null}

      {blockedItems.length > 0 ? (
        <section className="space-y-2 rounded-lg border border-red-300 bg-red-50 p-4">
          <h2 className="font-semibold text-red-900">These rows cannot be imported</h2>
          <p className="text-sm text-red-900">
            They are left alone. Fix them in the file and import it again — the rows that
            did work will read as unchanged.
          </p>
          {blockedItems.map(({ item, index }) => (
            <div key={index} className="rounded-md border bg-white p-3 text-sm">
              <span className="font-medium">
                {item.candidate.name || item.candidate.email || 'row'}{' '}
              </span>
              <span className="text-muted-foreground">(file row {item.candidate.rowNumber})</span>
              <span className="mt-1 block text-red-900">{item.blockedReason}</span>
            </div>
          ))}
        </section>
      ) : null}

      {counts.updated > 0 ? (
        <section className="space-y-2 rounded-lg border p-4">
          <h2 className="font-semibold">Changes to existing staff</h2>
          <p className="text-sm text-muted-foreground">
            Email addresses are never changed by an import, and no password is touched.
          </p>
          {updatedItems.map(({ item, index }) => (
            <label key={index} className="flex items-start gap-3 rounded-md border bg-white p-3">
              <input
                type="checkbox"
                checked={!excluded.includes(index)}
                onChange={(e) => toggle(index, e.target.checked)}
                className="mt-1 h-4 w-4"
              />
              <span className="min-w-0">
                <span className="font-medium">{item.candidate.name || item.candidate.email}</span>{' '}
                <span className="text-sm text-muted-foreground">{item.candidate.email}</span>
                <span className="mt-1 block space-y-0.5 text-sm text-muted-foreground">
                  {item.changes.map((c) => (
                    <span key={c.field} className="block">
                      {c.field}: <span className="line-through">{c.from || '—'}</span> → {c.to}
                    </span>
                  ))}
                  {item.warnings.map((w) => (
                    <span key={w} className="block text-amber-700">
                      {w}
                    </span>
                  ))}
                </span>
              </span>
            </label>
          ))}
        </section>
      ) : null}

      {counts.new > 0 ? (
        <section className="space-y-2 rounded-lg border p-4">
          <h2 className="font-semibold">
            {counts.new} new {counts.new === 1 ? 'account' : 'accounts'}
          </h2>
          <p className="text-sm text-muted-foreground">
            Each gets a temporary password, shown once on the next screen.
          </p>
          {newItems.map(({ item, index }) => (
            <label key={index} className="flex items-start gap-3 rounded-md border bg-white p-3">
              <input
                type="checkbox"
                checked={!excluded.includes(index)}
                onChange={(e) => toggle(index, e.target.checked)}
                className="mt-1 h-4 w-4"
              />
              <span className="min-w-0 text-sm">
                <span className="font-medium">{item.candidate.name}</span>{' '}
                <span className="text-muted-foreground">{item.candidate.email}</span>{' '}
                <Badge variant={item.candidate.role === 'instructor' ? 'amber' : 'secondary'}>
                  {item.candidate.role}
                </Badge>
                {item.warnings.map((w) => (
                  <span key={w} className="mt-1 block text-amber-700">
                    {w}
                  </span>
                ))}
              </span>
            </label>
          ))}
        </section>
      ) : null}

      {counts.unchanged > 0 ? (
        <p className="text-sm text-muted-foreground">
          {counts.unchanged} {counts.unchanged === 1 ? 'person is' : 'people are'} already up to
          date and will not be touched.
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="button" onClick={onCommit} disabled={committing || toApply < 1}>
          {committing ? 'Importing…' : `Import ${toApply} ${toApply === 1 ? 'change' : 'changes'}`}
        </Button>
        <Button type="button" variant="ghost" onClick={() => window.location.reload()}>
          Start over
        </Button>
      </div>

      {commitError ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {commitError}
        </p>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'green' | 'amber' | 'red' | 'secondary';
}) {
  return (
    <div className="flex items-center gap-2">
      <Badge variant={tone}>{value}</Badge>
      <span className="text-sm">{label}</span>
    </div>
  );
}
