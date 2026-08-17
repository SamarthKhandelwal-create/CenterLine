import { requireSession } from '@/lib/auth/current-user';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { enrollKioskAction } from './actions';

export default async function KioskEnrollPage() {
  const { centre } = await requireSession();

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-4 pt-6">
          <div>
            <h1 className="text-xl font-semibold">Set up this tablet</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              This device will run the check-in screen for {centre.name}. It stays signed in as a
              device, not as you — no roster details or phone numbers are exposed on the kiosk.
            </p>
          </div>
          <form action={enrollKioskAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="label">Where is it?</Label>
              <Input id="label" name="label" defaultValue="Front door" maxLength={60} />
            </div>
            <Button type="submit" className="w-full">
              Start kiosk mode
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
