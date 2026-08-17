import { NextResponse } from 'next/server';
import { requireInstructor } from '@/lib/auth/current-user';
import { analyzeImport } from '@/lib/import/analyze';
import { MAX_IMPORT_BYTES } from '@/lib/import/parse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * File upload goes through a route handler rather than a server action: actions have
 * a small default body limit and are awkward to stream a spreadsheet through, while a
 * route handler takes the multipart body directly and returns the review plan as JSON.
 */
export async function POST(request: Request) {
  const { centre } = await requireInstructor();

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Choose a CSV or Excel file to import.' }, { status: 400 });
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return NextResponse.json(
      { error: 'That file is larger than 5 MB. Export just the roster and try again.' },
      { status: 400 },
    );
  }

  try {
    const plan = await analyzeImport(centre.id, Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ plan, fileName: file.name });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'That file could not be read.' },
      { status: 400 },
    );
  }
}
