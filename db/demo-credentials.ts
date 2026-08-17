import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type DemoCredential = {
  id: string;
  centreName?: string;
  firstName: string;
  lastInitial: string;
  token: string;
};

export const DEMO_CREDENTIALS_PATH = join(process.cwd(), '.demo-credentials.json');

/**
 * The database stores only HMACs, so the plaintext demo PINs and QR tokens cannot be
 * recovered from it. The seed writes them here instead, for printing test cards and
 * for the browser verification script. Gitignored, and never read in production.
 */
export async function loadDemoCredentials(): Promise<DemoCredential[]> {
  try {
    return JSON.parse(await readFile(DEMO_CREDENTIALS_PATH, 'utf8')) as DemoCredential[];
  } catch {
    return [];
  }
}

export async function seedCredentialsFor(
  roster: { id: string; firstName: string; lastInitial: string }[],
): Promise<DemoCredential[]> {
  const creds = await loadDemoCredentials();
  const byId = new Map(creds.map((c) => [c.id, c]));
  return roster
    .map((r) => {
      const c = byId.get(r.id);
      return c ? { ...r, token: c.token } : null;
    })
    .filter((x): x is DemoCredential => x !== null);
}
