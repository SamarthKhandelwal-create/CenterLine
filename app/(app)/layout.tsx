import Link from 'next/link';
import { requireSession } from '@/lib/auth/current-user';
import { Button } from '@/components/ui/button';

const INSTRUCTOR_NAV = [
  { href: '/floor', label: 'Floor' },
  { href: '/students', label: 'Students' },
  { href: '/day', label: 'Day' },
  { href: '/history', label: 'History' },
  { href: '/staff', label: 'Staff' },
  { href: '/compliance', label: 'Compliance' },
] as const;

const ASSISTANT_NAV = [{ href: '/floor', label: 'Floor' }] as const;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, centre } = await requireSession();
  const nav = user.role === 'instructor' ? INSTRUCTOR_NAV : ASSISTANT_NAV;

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="no-print sticky top-0 z-40 border-b bg-background">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-4">
          <Link href="/floor" className="font-semibold tracking-tight">
            Centerline
          </Link>
          <nav className="flex items-center gap-1">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {/* Opens the student-facing screen. On the door tablet this is pressed once
                and then left; on a desktop it is how staff check the kiosk is working. */}
            <Link href="/kiosk" target="_blank" rel="noreferrer">
              <Button variant="outline" size="sm" className="font-semibold">
                Open kiosk
              </Button>
            </Link>
            {/* One tap from every page. This is the fire-drill button. */}
            <Link href="/emergency">
              <Button variant="destructive" size="sm" className="font-semibold">
                Emergency
              </Button>
            </Link>
            <span className="hidden text-sm text-muted-foreground sm:inline">{centre.name}</span>
            <form method="post" action="/api/auth/logout">
              <Button type="submit" variant="ghost" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] p-4">{children}</main>
    </div>
  );
}
