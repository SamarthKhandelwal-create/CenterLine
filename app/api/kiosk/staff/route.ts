import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getKioskDevice } from '@/lib/auth/current-user';
import { toggleStaffShift } from '@/lib/kiosk/staff';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ userId: z.string().uuid() });

/**
 * Staff clock in / out from the tablet by the door.
 *
 * Gated twice: the device cookie must be valid, and the tablet must have been put into
 * kiosk mode by an instructor. An assistant can still enrol a device — it just runs the
 * student screen alone, with no way to touch anybody's hours.
 */
export async function POST(request: Request) {
  const device = await getKioskDevice();
  if (!device || device.enrolledByRole !== 'instructor') {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // A staff of five clocking in and out twice each is nowhere near this; anything that
  // is, is not a person at a door.
  const limited = rateLimit(`staff-shift:${device.centre.id}`, 30, 60_000);
  if (!limited.ok) return NextResponse.json({ ok: false }, { status: 429 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false });

  return NextResponse.json(
    await toggleStaffShift({ centre: device.centre, userId: parsed.data.userId }),
  );
}
