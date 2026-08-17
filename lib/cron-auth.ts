import { timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. */
export function isAuthorizedCron(request: Request): boolean {
  const header = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${env.CRON_SECRET}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
