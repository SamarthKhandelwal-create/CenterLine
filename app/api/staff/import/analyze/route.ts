import { NextResponse } from 'next/server';
import { requireInstructor } from '@/lib/auth/current-user';
import { MAX_IMPORT_BYTES } from '@/lib/import/parse';
import { analyzeStaffImport } from '@/lib/staff/import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Same shape as the roster importer: the file goes to a route handler, not an action. */
export async function POST(request: Request) {
  const { centre } = await requireInstructor();

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Choose a CSV or Excel file to import.' }, { status: 400 });
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return NextResponse.json(
      { error: 'That file is larger than 5 MB. Export just the staff list and try again.' },
      { status: 400 },
    );
  }

  try {
    const plan = await analyzeStaffImport(centre.id, Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ plan, fileName: file.name });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'That file could not be read.' },
      { status: 400 },
    );
  }
}
