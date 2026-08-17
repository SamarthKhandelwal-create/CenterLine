import Link from 'next/link';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { credential as credentialT, student as studentT } from '@/db/schema';
import { requireInstructor } from '@/lib/auth/current-user';
import { loadDemoCredentials } from '@/db/demo-credentials';
import { qrSvgDataUri } from '@/lib/pdf/qr';
import { Button } from '@/components/ui/button';
import { PrintButton } from '@/components/print-button';
import { IssueCardsForm } from './issue-form';

export const dynamic = 'force-dynamic';

/**
 * Printable QR cards, 8 to a page.
 *
 * The database stores only an HMAC of each token, so an existing token cannot be read
 * back to reprint it. Fresh tokens are therefore minted by an explicit action (which
 * revokes the previous card), never as a side effect of opening this page — otherwise
 * a stray visit would invalidate every card in the centre.
 *
 * The QR encodes ONLY the token: no name, no centre, nothing identifying if the card
 * is dropped in a car park. The human-readable name is printed beside it, on the card.
 */
export default async function CardsPage({
  searchParams,
}: {
  searchParams: Promise<{ issued?: string }>;
}) {
  const { centre } = await requireInstructor();
  const { issued } = await searchParams;

  const students = await db
    .select({ id: studentT.id, firstName: studentT.firstName, lastInitial: studentT.lastInitial })
    .from(studentT)
    .where(and(eq(studentT.centreId, centre.id), eq(studentT.status, 'active')))
    .orderBy(studentT.firstName, studentT.lastInitial);

  // Tokens to print come from one of two places, in order:
  //  1. an issue action in this session (held in a short-lived cookie-free URL list)
  //  2. the seed's demo-credentials file, so the demo can print cards without
  //     invalidating anything. Neither exists in a real production centre until the
  //     instructor presses "Issue new cards".
  const issuedIds = new Set((issued ?? '').split(',').filter(Boolean));
  const demo = await loadDemoCredentials();
  const demoById = new Map(demo.map((d) => [d.id, d.token]));

  const printable = await Promise.all(
    students
      .map((s) => ({ ...s, token: demoById.get(s.id) }))
      .filter((s): s is typeof s & { token: string } => Boolean(s.token))
      .map(async (s) => ({ ...s, qr: await qrSvgDataUri(s.token) })),
  );

  const activeCards = await db
    .select({ studentId: credentialT.studentId })
    .from(credentialT)
    .where(
      and(
        eq(credentialT.centreId, centre.id),
        eq(credentialT.kind, 'qr'),
        isNull(credentialT.revokedAt),
      ),
    )
    .orderBy(desc(credentialT.id));

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight">QR cards</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {students.length} active students · {activeCards.length} cards currently valid.
            Codes are stored one-way, so a card can be reprinted only by issuing a new one —
            which immediately stops the old card working.
          </p>
          {issuedIds.size > 0 ? (
            <p className="mt-2 text-sm font-medium text-emerald-700">
              Issued {issuedIds.size} new {issuedIds.size === 1 ? 'card' : 'cards'}. Print this
              sheet now — these codes are shown once.
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Link href="/students">
            <Button variant="ghost">Back</Button>
          </Link>
          <IssueCardsForm count={students.length} />
          {printable.length > 0 ? <PrintButton /> : null}
        </div>
      </div>

      {printable.length === 0 ? (
        <div className="no-print rounded-lg border border-dashed p-10 text-center">
          <p className="font-medium">No printable codes available</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Card codes are hashed and cannot be read back. Press{' '}
            <span className="font-medium">Issue new cards</span> to mint a fresh set and print
            them. Any previously printed card will stop working.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 print:gap-0">
          {printable.map((c, i) => (
            <div
              key={c.id}
              className={`flex items-center gap-4 rounded-lg border bg-white p-4 print:rounded-none print:border-dashed ${
                (i + 1) % 8 === 0 ? 'print-page-break' : ''
              }`}
              style={{ minHeight: '2.4in' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.qr} alt="" width={150} height={150} className="shrink-0" />
              <div className="min-w-0">
                <p className="truncate text-2xl font-bold">
                  {c.firstName} {c.lastInitial}.
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{centre.name}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
