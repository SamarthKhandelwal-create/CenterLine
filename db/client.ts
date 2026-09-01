import type { PgliteDatabase } from 'drizzle-orm/pglite';
import * as schema from './schema';
import { acquireLock } from './pglite-lock';

/**
 * Two drivers, one Drizzle API:
 *   - pglite: local dev and tests. No daemon, no container, persists to a directory.
 *   - postgres: Neon / any Postgres over the wire. Used in production.
 * Selected by DATABASE_DRIVER. Application code never knows which is in play.
 *
 * Both drivers expose the same query builder surface for everything this app does
 * (select/insert/transaction/execute), so the shared type is the PGlite one and the
 * postgres-js instance is asserted to it at the single boundary below.
 */
export type Db = PgliteDatabase<typeof schema>;

function driver(): 'pglite' | 'postgres' {
  const explicit = process.env.DATABASE_DRIVER;
  if (explicit === 'pglite' || explicit === 'postgres') return explicit;
  const url = process.env.DATABASE_URL ?? '';
  return url.startsWith('file:') || url === '' || url === 'memory://' ? 'pglite' : 'postgres';
}

export function createDb(): Db {
  if (driver() === 'pglite') {
    const { PGlite } = require('@electric-sql/pglite') as typeof import('@electric-sql/pglite');
    const { drizzle } = require('drizzle-orm/pglite') as typeof import('drizzle-orm/pglite');
    const raw = process.env.DATABASE_URL ?? 'file:./.pgdata';
    const dir = raw === 'memory://' ? undefined : raw.replace(/^file:/, '');
    // Claim the directory first: this throws if another live process holds it,
    // rather than opening a second writer and corrupting the database.
    if (dir) acquireLock(dir);
    try {
      return drizzle(new PGlite(dir), { schema, casing: 'snake_case' });
    } catch (err) {
      throw new Error(
        `The local database at ${dir ?? 'memory'} could not be opened. If a server was ` +
          'force-killed it may be damaged or hold a stale lock file; run `pnpm db:reset` ' +
          `to rebuild it.\n\nUnderlying error: ${(err as Error).message}`,
      );
    }
  }

  const postgres = require('postgres') as typeof import('postgres');
  const { drizzle } = require('drizzle-orm/postgres-js') as typeof import('drizzle-orm/postgres-js');
  // `connect_timeout` is stated rather than left to the default because a managed
  // Postgres that scales to zero answers the first connection only after it has woken
  // up; 30s is comfortably more than that costs, and a request waiting is better than
  // a request failing.
  const client = postgres(process.env.DATABASE_URL!, {
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 30,
  });
  return normalizeExecute(drizzle(client, { schema, casing: 'snake_case' })) as unknown as Db;
}

/**
 * The one place the two drivers genuinely disagree.
 *
 * `db.execute()` under PGlite resolves to `{ rows }`; under postgres-js it resolves to
 * a plain array. Every raw-SQL call site in this codebase reads `.rows`, and the cast
 * on the return above means TypeScript checks them against the PGlite shape — so the
 * mismatch is invisible at compile time and shows up only as
 * `Cannot read properties of undefined (reading 'length')` against a real Postgres.
 *
 * Normalising here keeps that cast honest: `execute` returns `{ rows }` on both
 * drivers, so application code never learns which one it is talking to. Transactions
 * get the same treatment, because `tx.execute` is a different object.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
function normalizeExecute<T>(database: T): T {
  const target = database as any;

  const wrap = (execute: (...args: any[]) => Promise<any>) =>
    async (...args: any[]) => {
      const result = await execute(...args);
      return Array.isArray(result) ? { rows: result, rowCount: result.length } : result;
    };

  target.execute = wrap(target.execute.bind(target));

  const runTransaction = target.transaction.bind(target);
  target.transaction = (callback: (tx: any) => unknown, config?: unknown) =>
    runTransaction((tx: any) => {
      tx.execute = wrap(tx.execute.bind(tx));
      return callback(tx);
    }, config);

  return target as T;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
