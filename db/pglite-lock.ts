import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * PGlite is a single-writer embedded database: two processes opening the same data
 * directory corrupts it, and the corruption is silent until a later read fails deep in
 * the storage manager.
 *
 * Each process that opens the directory records its pid beside it, and any other
 * process that tries to open it while that pid is alive fails immediately with a
 * message naming the holder. Nothing here ever deletes a lock it does not own, and
 * nothing deletes Postgres's own postmaster.pid — an earlier version did, which is
 * exactly how a live database got corrupted.
 *
 * Only relevant to local development; production runs on Neon, where concurrent
 * connections are the whole point.
 */

/** The lock sits BESIDE the data directory: PGlite's initdb requires an empty one. */
export function lockPathFor(dataDir: string): string {
  return `${resolve(dataDir)}.lock`;
}

function pidAlive(pid: number): boolean {
  try {
    // Signal 0 tests for existence without touching the process.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The pid currently holding the directory, or null if it is free. */
export function currentHolder(dataDir: string): number | null {
  const lock = lockPathFor(dataDir);
  if (!existsSync(lock)) return null;
  const pid = Number(readFileSync(lock, 'utf8').trim());
  if (!Number.isFinite(pid) || pid === process.pid) return null;
  return pidAlive(pid) ? pid : null; // a lock left by a dead process is ignored
}

function holderError(dataDir: string, pid: number): Error {
  return new Error(
    `The local database at ${dataDir} is already open in process ${pid}.\n\n` +
      'PGlite allows a single writer, so opening it here would corrupt it. Stop the\n' +
      'other process first:\n\n' +
      `  kill ${pid}\n\n` +
      'then try again. (Use kill, not kill -9 — a force-kill can damage the database.)',
  );
}

/**
 * Claims the directory for this process. Throws rather than overwriting if another
 * live process holds it, so the server, the seed and any script all fail the same way.
 */
export function acquireLock(dataDir: string): void {
  const holder = currentHolder(dataDir);
  if (holder !== null) throw holderError(dataDir, holder);

  const lock = lockPathFor(dataDir);
  mkdirSync(dirname(lock), { recursive: true });
  writeFileSync(lock, String(process.pid));

  const release = () => {
    try {
      // Only ever remove our own lock.
      if (existsSync(lock) && readFileSync(lock, 'utf8').trim() === String(process.pid)) {
        rmSync(lock, { force: true });
      }
    } catch {
      // A leftover lock from a hard kill is detected as stale on the next run.
    }
  };
  process.once('exit', release);
  process.once('SIGINT', () => {
    release();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    release();
    process.exit(143);
  });
}

/** Called by the seed before it drops and rebuilds every table. */
export function assertExclusive(dataDir: string): void {
  const holder = currentHolder(dataDir);
  if (holder !== null) throw holderError(dataDir, holder);
}
