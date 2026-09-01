import { sql } from 'drizzle-orm';
import { db } from '@/db';

/**
 * Runs once when the Node server starts (not during `next build`).
 *
 * Opening the database here surfaces a bad DATABASE_URL at boot rather than on an
 * instructor's first request, and for local PGlite it claims the single-writer lock
 * immediately — so `pnpm db:seed` refuses to overwrite the data directory underneath
 * a running server instead of silently corrupting it.
 *
 * It does NOT rethrow on a serverless host, and that distinction is the whole point.
 * A throw here fails `register()`, Next reports "Failed to prepare server", and the
 * instance serves 500 for every route it is handed — including /login, which is how
 * somebody would recover. On Vercel the database is a managed Postgres that scales to
 * zero, so a cold lambda landing on a suspended endpoint hits CONNECT_TIMEOUT during
 * init through no fault of the configuration; turning that transient wake-up into a
 * dead instance is a self-inflicted outage.
 *
 * Locally the old behaviour is right and is kept: PGlite is on disk and always there,
 * so a failure genuinely means a bad URL or a damaged directory, and failing loudly at
 * `pnpm dev` beats a confusing error on the first page load.
 *
 * Nothing is lost in production either way — the first request opens its own
 * connection, and a genuinely bad URL still fails that request with this line already
 * in the log above it.
 */
const isServerless = process.env.VERCEL === '1';

try {
  await db.execute(sql`SELECT 1`);
  console.log('[centerline] database ready');
} catch (err) {
  console.error('[centerline] database unavailable at startup:', (err as Error).message);
  if (!isServerless) throw err;
  console.error('[centerline] continuing anyway; requests will reconnect on demand');
}
