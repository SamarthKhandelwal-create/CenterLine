import Link from 'next/link';
import { MIN_PASSWORD_LENGTH, checkResetToken } from '@/lib/auth/password-reset';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export const dynamic = 'force-dynamic';

const MESSAGES: Record<string, string> = {
  missing: 'Enter your new password twice.',
  mismatch: 'Those two passwords are not the same.',
  weak: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
  throttled: 'Too many attempts. Wait a few minutes and try again.',
};

/** A link that cannot be used, and the one sentence that says what to do about it. */
const DEAD_LINK: Record<string, string> = {
  unknown: 'This reset link is not valid. It may have been mistyped or already replaced.',
  used: 'This reset link has already been used. Request a new one if you need to change your password again.',
  expired: 'This reset link has expired. Reset links are only good for a short time.',
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token = '', error } = await searchParams;

  // Checked but not spent. A dead link should be a sentence on this screen, not a
  // form that fails after somebody has typed a password into it twice.
  const check = await checkResetToken(token);

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">Centerline</h1>
          <p className="mt-1 text-sm text-muted-foreground">Choose a new password</p>
        </div>
        <Card>
          <CardContent className="pt-6">
            {!check.valid ? (
              <div className="space-y-4">
                <p role="alert" className="text-sm font-medium text-destructive">
                  {DEAD_LINK[check.reason]}
                </p>
                <Link href="/forgot-password">
                  <Button className="w-full">Send a new link</Button>
                </Link>
              </div>
            ) : (
              <form method="post" action="/api/auth/reset-password" className="space-y-4">
                <input type="hidden" name="token" value={token} />
                <div className="space-y-2">
                  <Label htmlFor="password">New password</Label>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={MIN_PASSWORD_LENGTH}
                    required
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground">
                    At least {MIN_PASSWORD_LENGTH} characters.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm">Confirm new password</Label>
                  <Input
                    id="confirm"
                    name="confirm"
                    type="password"
                    autoComplete="new-password"
                    minLength={MIN_PASSWORD_LENGTH}
                    required
                  />
                </div>
                {error ? (
                  <p role="alert" className="text-sm font-medium text-destructive">
                    {MESSAGES[error] ?? 'Could not change your password. Try again.'}
                  </p>
                ) : null}
                <Button type="submit" className="w-full">
                  Set new password
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
