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
