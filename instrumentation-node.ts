import { sql } from 'drizzle-orm';
import { db } from '@/db';

/**
 * Runs once when the Node server starts (not during `next build`).
 *
 * Opening the database here surfaces a bad DATABASE_URL at boot rather than on an
 * instructor's first request, and for local PGlite it claims the single-writer lock
 * immediately — so `pnpm db:seed` refuses to overwrite the data directory underneath
 * a running server instead of silently corrupting it.
 */
try {
  await db.execute(sql`SELECT 1`);
  console.log('[centerline] database ready');
} catch (err) {
  console.error('[centerline] database unavailable at startup:', (err as Error).message);
  throw err;
}
