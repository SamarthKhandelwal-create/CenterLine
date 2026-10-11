import Link from 'next/link';
import { getKioskDevice, requireSession } from '@/lib/auth/current-user';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { enrollKioskAction } from './actions';

export default async function KioskEnrollPage({
  searchParams,
}: {
  searchParams: Promise<{ switched?: string; mismatch?: string }>;
}) {
  const { user, centre } = await requireSession();
  const params = await searchParams;
  const switched = params.switched === '1';
  // This device is already a kiosk, but for a different centre than the account signed
  // in on this browser. Naming both is the point: whoever is here has to say which one
  // they meant, because guessing shows a stranger's children.
  const device = params.mismatch === '1' ? await getKioskDevice() : null;
  const mismatch = device !== null && device.centre.id !== centre.id;

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-4 pt-6">
          <div>
            <h1 className="text-xl font-semibold">Set up this tablet</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              This device will run the check-in screen. It stays signed in as a device, not as
              you — no roster details or phone numbers are exposed on the kiosk.
            </p>
          </div>

          {switched ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              The signed-in account changed while this page was open, so nothing was set up.
              Check the centre below and try again.
            </div>
          ) : null}

          {mismatch && device ? (
            <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">This tablet is already set up for a different centre.</p>
              <p>
                It runs the check-in screen for <strong>{device.centre.name}</strong>, but you are
                signed in to <strong>{centre.name}</strong>. Nothing has changed — say which one
                you meant.
              </p>
              {/* Keeping the existing kiosk is the common case: a staff member signed in
                  on the door tablet to look something up. It must not require re-enrolling
                  a working device, and it must not need the other centre's password. */}
              <form method="post" action="/api/auth/logout">
                <input type="hidden" name="next" value="/kiosk" />
                <Button type="submit" variant="outline" className="w-full">
                  Keep the {device.centre.name} kiosk and sign out
                </Button>
              </form>
              <p className="text-xs">
                Or set this tablet up for {centre.name} below. That replaces the kiosk for
                everyone using this device.
              </p>
            </div>
          ) : null}

          {/* Cookies are shared across every tab in a browser, so the account this page
              found is whoever signed in last here — not necessarily the account in the tab
              the kiosk was opened from. Naming it is the whole point of this block: the
              centre below is the roster the tablet will show until it is set up again. */}
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <p className="font-medium">Setting up for {centre.name}</p>
            <p className="mt-1 text-muted-foreground">
              Using the account signed in on this browser: {user.email}.
            </p>
            <p className="mt-2 text-muted-foreground">
              Wrong centre?{' '}
              <Link href="/login?next=/kiosk/enroll" className="font-medium underline">
                Sign in as someone else
              </Link>{' '}
              first.
            </p>
          </div>

          <form action={enrollKioskAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="label">Where is it?</Label>
              <Input id="label" name="label" defaultValue="Front door" maxLength={60} />
            </div>
            {/* The centre this page showed travels with the submit, so a sign-in in
                another tab between render and submit cannot silently redirect the
                tablet to a different roster. */}
            <input type="hidden" name="centreId" value={centre.id} />
            <Button type="submit" className="w-full">
              Start kiosk mode for {centre.name}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
