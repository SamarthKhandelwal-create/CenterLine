import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/** promisify() drops the options overload, so wrap it explicitly. */
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derived) =>
      err ? reject(err) : resolve(derived),
    );
  });
}

const N = 16384;
const r = 8;
const p = 1;
const KEYLEN = 64;

/**
 * scrypt from node:crypto — memory-hard, no native dependency. Parameters are
 * stored in the hash string so they can be raised later without a migration.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize("NFKC"), salt, KEYLEN, { N, r, p });
  return ['scrypt', N, r, p, salt.toString('base64url'), derived.toString('base64url')].join('$');
}

/**
 * A password for an account somebody else created — read aloud, typed once, changed
 * later. The alphabet omits l, o, 0 and 1 because this gets written on a sticky note,
 * and the grouping is there so it can be dictated across a desk.
 *
 * Exactly 32 symbols, so the modulo below is unbiased. 15 characters is 75 bits, far
 * beyond what a temporary credential needs; the shape is for the human, not the entropy.
 */
export function generateTemporaryPassword(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(15);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return [chars.slice(0, 5), chars.slice(5, 10), chars.slice(10, 15)]
    .map((group) => group.join(''))
    .join('-');
}

/**
 * The `password_hash` of an account that has no password and therefore cannot sign in.
 *
 * Staff clock in and out at the kiosk by tapping their tile, which needs an account to
 * hang the name and the shifts on but no credential of any kind. Rather than invent a
 * password nobody will use and store it as a real hash, such an account holds this
 * marker: `verifyPassword` rejects it like any other malformed hash, so sign-in fails
 * through the ordinary path with the ordinary message and no special case at the door.
 *
 * Not a null column, deliberately. `password_hash` is NOT NULL, and a nullable one would
 * make "no password" indistinguishable from "we forgot to set one" at every call site.
 */
export const NO_PASSWORD = 'no-password';

/** False for an account that exists only as a name on the kiosk. */
export function canSignIn(passwordHash: string): boolean {
  return passwordHash !== NO_PASSWORD;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64!, 'base64url');
  const expected = Buffer.from(hashB64!, 'base64url');
  const derived = await scrypt(password.normalize("NFKC"), salt, expected.length, {
    N: Number(nStr),
    r: Number(rStr),
    p: Number(pStr),
  });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
