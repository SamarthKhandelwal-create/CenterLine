import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getKioskCentre } from '@/lib/auth/current-user';
import { resolveScanAndToggle } from '@/lib/kiosk/resolve';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ token: z.string().min(4).max(128) });

export async function POST(request: Request) {
  const centre = await getKioskCentre();
  if (!centre) return NextResponse.json({ ok: false }, { status: 401 });

  // Generous enough for a queue of children scanning back to back, tight enough
  // that the endpoint is not a token-guessing oracle.
  const limited = rateLimit(`scan:${centre.id}`, 60, 60_000);
  if (!limited.ok) return NextResponse.json({ ok: false }, { status: 429 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false });

  return NextResponse.json(await resolveScanAndToggle({ centre, token: parsed.data.token }));
}
