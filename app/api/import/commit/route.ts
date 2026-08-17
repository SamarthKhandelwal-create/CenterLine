import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireInstructor } from '@/lib/auth/current-user';
import { commitImport } from '@/lib/import/commit';
import type { ImportPlan } from '@/lib/import/analyze';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const bodySchema = z.object({
  plan: z.unknown(),
  resolutions: z.record(z.string(), z.string()).optional(),
  excluded: z.array(z.number().int()).optional(),
});

export async function POST(request: Request) {
  const { centre } = await requireInstructor();

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'The review data was incomplete. Re-upload the file.' }, { status: 400 });
  }

  try {
    const result = await commitImport({
      centreId: centre.id,
      plan: parsed.data.plan as ImportPlan,
      resolutions: Object.fromEntries(
        Object.entries(parsed.data.resolutions ?? {}).map(([k, v]) => [Number(k), v]),
      ),
      excluded: parsed.data.excluded ?? [],
    });
    revalidatePath('/students');
    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'The import could not be applied.' },
      { status: 400 },
    );
  }
}
