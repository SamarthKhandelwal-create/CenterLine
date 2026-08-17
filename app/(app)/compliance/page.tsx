import { requireInstructor } from '@/lib/auth/current-user';
import {
  captureStatistics,
  evaluateRequirements,
  RETENTION_POLICY,
} from '@/lib/compliance/requirements';
import { currentAttestations } from '@/lib/compliance/attestations';
import { addDays, formatLocalDate, localDateString } from '@/lib/time/centre-time';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AttestForm } from './attest-form';

export const dynamic = 'force-dynamic';

export default async function CompliancePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { centre } = await requireInstructor();
  const sp = await searchParams;

  const today = localDateString(new Date(), centre.timezone);
  const from = sp.from || addDays(today, -30);
  const to = sp.to || today;

  const attestations = await currentAttestations(centre.id);
  const ctx = { centre, from, to, attestations };
  const [results, stats] = await Promise.all([evaluateRequirements(ctx), captureStatistics(ctx)]);

  const met = results.filter((r) => r.status === 'green').length;
  const totalEvents = stats.reduce((sum, s) => sum + Number(s.count), 0);
  const evidenceHref = `/api/compliance/evidence?from=${from}&to=${to}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Compliance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Kumon baseline check-in/check-out requirements · {centre.name}
          </p>
          <p className="mt-1 text-sm">
            <span className={met === results.length ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700'}>
              {met} of {results.length} requirements met
            </span>{' '}
            <span className="text-muted-foreground">
              · measured over {from} to {to}
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/api/compliance/backup" download>
            <Button variant="outline">Download backup</Button>
          </a>
          <a href={evidenceHref} target="_blank" rel="noreferrer">
            <Button>Generate evidence pack</Button>
          </a>
        </div>
      </div>

      <div className="rounded-lg border bg-background">
        <ul className="divide-y">
          {results.map((r) => (
            <li key={r.id} className="p-4">
              <div className="flex items-start gap-4">
                <Badge
                  variant={r.status === 'green' ? 'green' : 'amber'}
                  className="mt-0.5 w-20 shrink-0 justify-center"
                >
                  {r.status === 'green' ? 'Met' : 'Action'}
                </Badge>

                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {r.number}. {r.title}
                  </p>
                  {/* The checklist wording, verbatim — this is what a reviewer reads. */}
                  <p className="mt-1 border-l-2 border-muted pl-3 text-sm italic text-muted-foreground">
                    {r.confirmation}
                  </p>
                  <p className="mt-2 text-sm">{r.evidence}</p>

                  {r.kind === 'attested' ? (
                    <div className="mt-3">
                      {r.attestedAt && r.status === 'green' ? (
                        <p className="text-sm text-muted-foreground">
                          Confirmed by {r.attestedBy} on{' '}
                          {formatLocalDate(r.attestedAt, centre.timezone)} · renews{' '}
                          {r.expiresAt ? formatLocalDate(r.expiresAt, centre.timezone) : '—'}
                        </p>
                      ) : null}
                      <AttestForm
                        requirementId={r.id}
                        title={r.title}
                        renewing={Boolean(r.attestedAt)}
                      />
                    </div>
                  ) : null}
                </div>

                <span className="shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                  {r.measure}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="pt-6">
            <h2 className="font-semibold">How attendance was captured</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              {totalEvents} records between {from} and {to}
            </p>
            <ul className="space-y-1 text-sm">
              {stats.map((s) => (
                <li key={s.method} className="flex justify-between gap-4">
                  <span>
                    {s.method === 'inferred'
                      ? 'Estimated by the system'
                      : s.method.replace('kiosk_', 'Kiosk ').replace('_', ' ')}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {s.count} ({Math.round((Number(s.count) / Math.max(1, totalEvents)) * 100)}%)
                  </span>
                </li>
              ))}
              {stats.length === 0 ? (
                <li className="text-muted-foreground">No records in this period.</li>
              ) : null}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <h2 className="font-semibold">Retention</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{RETENTION_POLICY}</p>
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        Centres certify annually that their check-in/check-out system meets these requirements and
        may be asked to demonstrate it during a review. The evidence pack is a dated PDF covering
        this period, suitable for that purpose.
      </p>
    </div>
  );
}
