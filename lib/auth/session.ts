import { z } from 'zod';

export const SESSION_COOKIE = 'cl_session';
export const KIOSK_COOKIE = 'cl_kiosk';
const SESSION_TTL_SECONDS = 60 * 60 * 12;

export const sessionClaims = z.object({
  uid: z.string().uuid(),
  cid: z.string().uuid(),
  role: z.enum(['instructor', 'assistant']),
  exp: z.number().int(),
});
export type SessionClaims = z.infer<typeof sessionClaims>;

export const kioskClaims = z.object({
  cid: z.string().uuid(),
  label: z.string(),
  exp: z.number().int(),
});
export type KioskClaims = z.infer<typeof kioskClaims>;

const enc = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const s = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(s, (ch) => ch.charCodeAt(0));
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

/**
 * Stateless signed token: base64url(JSON payload) + "." + base64url(HMAC).
 * Web Crypto only, so middleware (Edge) and route handlers (Node) share one path.
 */
export async function signToken(claims: object, secret: string): Promise<string> {
  const payload = b64urlEncode(enc.encode(JSON.stringify(claims)));
  const mac = await crypto.subtle.sign('HMAC', await key(secret), enc.encode(payload));
  return `${payload}.${b64urlEncode(new Uint8Array(mac))}`;
}

async function verifyToken(token: string, secret: string): Promise<unknown | null> {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  let ok = false;
  try {
    ok = await crypto.subtle.verify('HMAC', await key(secret), b64urlDecode(mac), enc.encode(payload));
  } catch {
    return null;
  }
  if (!ok) return null;
  try {
    return JSON.parse(new TextDecoder().decode(b64urlDecode(payload)));
  } catch {
    return null;
  }
}

export async function createSessionToken(
  claims: Omit<SessionClaims, 'exp'>,
  secret: string,
): Promise<string> {
  return signToken({ ...claims, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }, secret);
}

export async function readSessionToken(
  token: string | undefined,
  secret: string,
): Promise<SessionClaims | null> {
  if (!token) return null;
  const parsed = sessionClaims.safeParse(await verifyToken(token, secret));
  if (!parsed.success) return null;
  if (parsed.data.exp * 1000 < Date.now()) return null;
  return parsed.data;
}

export async function createKioskToken(
  centreId: string,
  label: string,
  secret: string,
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 400;
  return signToken({ cid: centreId, label, exp }, secret);
}

export async function readKioskToken(
  token: string | undefined,
  secret: string,
): Promise<KioskClaims | null> {
  if (!token) return null;
  const parsed = kioskClaims.safeParse(await verifyToken(token, secret));
  if (!parsed.success) return null;
  if (parsed.data.exp * 1000 < Date.now()) return null;
  return parsed.data;
}

export const SESSION_MAX_AGE = SESSION_TTL_SECONDS;
