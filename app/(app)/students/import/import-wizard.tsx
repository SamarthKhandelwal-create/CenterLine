'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { ImportPlan } from '@/lib/import/analyze';

type CommitResult = { created: number; updated: number; unchanged: number; skipped: number };

export function ImportWizard() {
  const router = useRouter();
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);

  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // The file is posted to a route handler, not a server action: actions cap the
  // request body well below a real roster export.
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
      const res = await fetch('/api/import/analyze', { method: 'POST', body });
      const data = (await res.json()) as { plan?: ImportPlan; fileName?: string; error?: string };
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

  const [resolutions, setResolutions] = useState<Record<number, string>>({});
  const [excluded, setExcluded] = useState<number[]>([]);

  async function onCommit() {
    if (!plan) return;
    setCommitting(true);
    setCommitError(null);
    try {
      const res = await fetch('/api/import/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan, resolutions, excluded }),
      });
      const data = (await res.json()) as { result?: CommitResult; error?: string };
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
      <Card className="max-w-xl">
        <CardContent className="space-y-4 pt-6">
          <h2 className="text-lg font-semibold">Import complete</h2>
          <ul className="space-y-1 text-sm">
            <li>{r.created} students added</li>
            <li>{r.updated} students updated</li>
            <li>{r.unchanged} unchanged</li>
            {r.skipped > 0 ? <li>{r.skipped} skipped</li> : null}
          </ul>
          <div className="flex gap-2">
            <Button onClick={() => router.push('/students')}>Back to students</Button>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Import another file
            </Button>
          </div>
        </CardContent>
      </Card>
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
              CSV, XLSX or XLS, up to 5 MB. Title rows above the headers are fine.
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
  // Only ambiguous and changed rows are worth an instructor's attention. Unchanged
  // rows are collapsed to a count — reviewing 200 identical rows is the thing that
  // makes people abandon an import.
  const needsReview = plan.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.action === 'ambiguous' || item.action === 'updated');
  const newItems = plan.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.action === 'new');
  const unresolved = plan.items.filter(
    (item, index) => item.action === 'ambiguous' && !resolutions[index],
  ).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 pt-6">
          <Stat label="New" value={counts.new} tone="green" />
          <Stat label="Updated" value={counts.updated} tone="amber" />
          <Stat label="Unchanged" value={counts.unchanged} tone="secondary" />
          {counts.ambiguous > 0 ? <Stat label="Need a decision" value={counts.ambiguous} tone="red" /> : null}
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

      {counts.ambiguous > 0 ? (
        <section className="space-y-2 rounded-lg border border-red-300 bg-red-50 p-4">
          <h2 className="font-semibold text-red-900">These rows match more than one student</h2>
          <p className="text-sm text-red-900">
            Pick who each row is, or add them as a new student. Nothing is merged automatically.
          </p>
          {needsReview
            .filter(({ item }) => item.action === 'ambiguous')
            .map(({ item, index }) => (
              <div key={index} className="rounded-md border bg-white p-3">
                <p className="font-medium">
                  {item.candidate.firstName} {item.candidate.lastInitial}.{' '}
                  <span className="text-sm font-normal text-muted-foreground">
                    (file row {item.candidate.rowNumbers.join(', ')})
                  </span>
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(item.options ?? []).map((o) => (
                    <Button
                      key={o.id}
                      type="button"
                      size="sm"
                      variant={resolutions[index] === o.id ? 'default' : 'outline'}
                      onClick={() => setResolutions((r) => ({ ...r, [index]: o.id }))}
                    >
                      {o.label}
                    </Button>
                  ))}
                  <Button
                    type="button"
                    size="sm"
                    variant={resolutions[index] === 'new' ? 'default' : 'outline'}
                    onClick={() => setResolutions((r) => ({ ...r, [index]: 'new' }))}
                  >
                    Add as new student
                  </Button>
                </div>
              </div>
            ))}
        </section>
      ) : null}

      {counts.updated > 0 ? (
        <section className="space-y-2 rounded-lg border p-4">
          <h2 className="font-semibold">Changes to existing students</h2>
          {needsReview
            .filter(({ item }) => item.action === 'updated')
            .map(({ item, index }) => (
              <label key={index} className="flex items-start gap-3 rounded-md border bg-white p-3">
                <input
                  type="checkbox"
                  checked={!excluded.includes(index)}
                  onChange={(e) =>
                    setExcluded((prev) =>
                      e.target.checked ? prev.filter((i) => i !== index) : [...prev, index],
                    )
                  }
                  className="mt-1 h-4 w-4"
                />
                <span className="min-w-0">
                  <span className="font-medium">
                    {item.candidate.firstName} {item.candidate.lastInitial}.
                  </span>
                  <span className="mt-1 block space-y-0.5 text-sm text-muted-foreground">
                    {item.changes.map((c) => (
                      <span key={c.field} className="block">
                        {c.field}: <span className="line-through">{c.from || '—'}</span> → {c.to}
                      </span>
                    ))}
                  </span>
                </span>
              </label>
            ))}
        </section>
      ) : null}

      {counts.new > 0 ? (
        <details className="rounded-lg border p-4">
          <summary className="cursor-pointer font-semibold">
            {counts.new} new {counts.new === 1 ? 'student' : 'students'}
          </summary>
          <ul className="mt-3 grid grid-cols-2 gap-2 text-sm lg:grid-cols-3">
            {newItems.map(({ item, index }) => (
              <li key={index} className="rounded border bg-white px-2 py-1">
                {item.candidate.firstName} {item.candidate.lastInitial}.{' '}
                <span className="text-muted-foreground">{item.candidate.subjects.join(', ')}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {counts.unchanged > 0 ? (
        <p className="text-sm text-muted-foreground">
          {counts.unchanged} rows are already up to date and will not be touched.
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="button" onClick={onCommit} disabled={committing || unresolved > 0}>
          {committing
            ? 'Importing…'
            : `Import ${counts.new + counts.updated - excluded.length} changes`}
        </Button>
        {unresolved > 0 ? (
          <span className="text-sm text-muted-foreground">
            {unresolved} {unresolved === 1 ? 'row needs' : 'rows need'} a decision first.
          </span>
        ) : null}
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
