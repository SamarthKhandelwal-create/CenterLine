import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getKioskCentre } from '@/lib/auth/current-user';
import { resolveTapAndToggle } from '@/lib/kiosk/resolve';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ studentId: z.string().uuid() });

export async function POST(request: Request) {
  const centre = await getKioskCentre();
  if (!centre) return NextResponse.json({ ok: false }, { status: 401 });

  // Generous enough for a queue of children arriving together, tight enough that the
  // endpoint cannot be driven in bulk.
  const limited = rateLimit(`tap:${centre.id}`, 90, 60_000);
  if (!limited.ok) return NextResponse.json({ ok: false }, { status: 429 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false });

  return NextResponse.json(
    await resolveTapAndToggle({ centre, studentId: parsed.data.studentId }),
  );
}
