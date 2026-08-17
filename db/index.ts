import 'server-only';
import * as schema from './schema';
import { createDb, type Db } from './client';

declare global {
  // eslint-disable-next-line no-var
  var __centerlineDb: Db | undefined;
}

function instance(): Db {
  // One instance per process. Next dev re-evaluates modules on every request, and a
  // fresh connection per request would exhaust the pool (or, for PGlite, fail to
  // acquire the data directory lock).
  globalThis.__centerlineDb ??= createDb();
  return globalThis.__centerlineDb;
}

/**
 * Connects on first use, not on import.
 *
 * `next build` evaluates every route module to collect page data. Connecting at
 * module scope meant the build opened a database connection it never used — noisy
 * with PGlite, and a real pool against Neon. This proxy defers that to the first
 * actual query.
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    const value = Reflect.get(instance() as object, prop, receiver);
    return typeof value === 'function' ? value.bind(instance()) : value;
  },
  has: (_target, prop) => Reflect.has(instance() as object, prop),
});

export { schema };
export type { Db };
