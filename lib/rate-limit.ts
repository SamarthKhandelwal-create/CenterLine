/**
 * In-memory fixed-window limiter. Per-instance on Vercel, which is a known limit —
 * for a kiosk on a centre LAN it is enough to stop a child mashing digits, and the
 * PIN path additionally locks out after 3 attempts in the UI.
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterMs: 0 };
  }
  existing.count += 1;
  if (existing.count > limit) return { ok: false, retryAfterMs: existing.resetAt - now };
  return { ok: true, retryAfterMs: 0 };
}

/** Keeps the map from growing without bound in a long-lived process. */
export function pruneRateLimits() {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
}
