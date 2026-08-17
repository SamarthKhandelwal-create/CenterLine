/**
 * Thin dispatcher. Next compiles this file for BOTH the Node and Edge runtimes, and
 * `process.env.NEXT_RUNTIME` is substituted at build time for each — so the Edge
 * bundle drops the import entirely rather than trying to resolve the Postgres
 * driver's node built-ins.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node');
  }
}
