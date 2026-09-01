import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireInstructor } from '@/lib/auth/current-user';
import { commitStaffImport, type StaffImportPlan } from '@/lib/staff/import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const bodySchema = z.object({
  plan: z.unknown(),
  excluded: z.array(z.number().int()).optional(),
});

export async function POST(request: Request) {
  const { centre, user } = await requireInstructor();

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'The review data was incomplete. Re-upload the file.' },
      { status: 400 },
    );
  }

  try {
    // The actor is taken from the session, never from the request body: it is what
    // stops an import demoting the person running it.
    const result = await commitStaffImport({
      centreId: centre.id,
      actorUserId: user.id,
      plan: parsed.data.plan as StaffImportPlan,
      excluded: parsed.data.excluded ?? [],
    });
    revalidatePath('/staff');
    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'The import could not be applied.' },
      { status: 400 },
    );
  }
}
