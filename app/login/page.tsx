import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/current-user';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export const dynamic = 'force-dynamic';

const MESSAGES: Record<string, string> = {
  invalid: 'Email or password is incorrect.',
  missing: 'Enter your email and password.',
  expired: 'Your session ended. Please sign in again.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; reset?: string }>;
}) {
  if (await getSession()) redirect('/floor');
  const { next, error, reset } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">Centerline</h1>
          <p className="mt-1 text-sm text-muted-foreground">Check-in and check-out</p>
        </div>
        <Card>
          <CardContent className="pt-6">
            {/* A plain form post, not a Server Action: this page has to work from a
                tab that was open across a deploy, since signing in is how you recover. */}
            {reset ? (
              <p
                role="status"
                className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
              >
                Password changed. Sign in with your new password.
              </p>
            ) : null}
            <form method="post" action="/api/auth/login" className="space-y-4">
              {next ? <input type="hidden" name="next" value={next} /> : null}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </div>
              {error ? (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {MESSAGES[error] ?? 'Could not sign you in. Try again.'}
                </p>
              ) : null}
              <Button type="submit" className="w-full">
                Sign in
              </Button>
              <Link
                href="/forgot-password"
                className="block text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
              >
                Forgot your password?
              </Link>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
