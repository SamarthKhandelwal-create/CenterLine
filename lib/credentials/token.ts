import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

/**
 * A printed QR contains only this token — no name, no centre, nothing that
 * identifies a child if the card is dropped in a car park.
 */
export function generateToken(): string {
  return randomBytes(16).toString('base64url');
}

/** Only the HMAC is stored. The token itself is shown once, at print time. */
export function hashToken(token: string): string {
  return createHmac('sha256', env.CREDENTIAL_HMAC_SECRET).update(token).digest('base64url');
}

export function tokenMatches(token: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(token));
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}
