import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/current-user';
import { RESET_EXPIRY_MINUTES } from '@/lib/email/templates';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export const dynamic = 'force-dynamic';

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  if (await getSession()) redirect('/floor');
  const { sent, error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">Centerline</h1>
          <p className="mt-1 text-sm text-muted-foreground">Reset your password</p>
        </div>
        <Card>
          <CardContent className="pt-6">
            {sent ? (
              /* Deliberately says "if" rather than "we sent". The server gives the same
                 answer for an address that has no account, so the screen must not
                 promise more than the server actually knows. */
              <div className="space-y-4">
                <p role="status" className="text-sm">
                  If that address belongs to a Centerline account, a reset link is on its
                  way. It expires in {RESET_EXPIRY_MINUTES} minutes.
                </p>
                <p className="text-sm text-muted-foreground">
                  Nothing arrived? Check the spam folder, then ask an instructor at your
                  centre to confirm the address on your account.
                </p>
                <Link href="/login">
                  <Button variant="outline" className="w-full">
                    Back to sign in
                  </Button>
                </Link>
              </div>
            ) : (
              <form method="post" action="/api/auth/forgot-password" className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Enter the email address on your account and we&apos;ll send you a link to
                  choose a new password.
                </p>
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
                {error ? (
                  <p role="alert" className="text-sm font-medium text-destructive">
                    Enter the email address on your account.
                  </p>
                ) : null}
                <Button type="submit" className="w-full">
                  Send reset link
                </Button>
                <Link
                  href="/login"
                  className="block text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
                >
                  Back to sign in
                </Link>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
