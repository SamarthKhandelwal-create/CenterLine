import './load-env';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { createDb } from './client';

/** Runs Drizzle migrations, then (re)applies views + append-only triggers. */
export async function runMigrations(db = createDb()) {
  const isPglite = (process.env.DATABASE_DRIVER ?? 'pglite') === 'pglite';
  const folder = join(process.cwd(), 'db', 'migrations');

  if (isPglite) {
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    await migrate(db, { migrationsFolder: folder });
  } else {
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(db as any, { migrationsFolder: folder });
  }

  const views = readFileSync(join(process.cwd(), 'db', 'views.sql'), 'utf8');
  for (const statement of splitSqlStatements(views)) {
    await db.execute(sql.raw(statement));
  }
  return db;
}

/**
 * Splits a SQL script on semicolons that are at top level — i.e. not inside a
 * string literal, a line comment, or a $$-quoted (or $tag$-quoted) body. Needed
 * because plpgsql function bodies contain semicolons, and PGlite's protocol
 * rejects multi-statement strings.
 */
export function splitSqlStatements(script: string): string[] {
  const out: string[] = [];
  let buf = '';
  let i = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let inSingle = false;
  let dollarTag: string | null = null;

  while (i < script.length) {
    const ch = script[i]!;
    const rest = script.slice(i);

    if (inLineComment) {
      buf += ch;
      if (ch === '\n') inLineComment = false;
      i += 1;
      continue;
    }
    if (inBlockComment) {
      buf += ch;
      if (rest.startsWith('*/')) {
        buf += '/';
        inBlockComment = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (dollarTag) {
      if (rest.startsWith(dollarTag)) {
        buf += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      buf += ch;
      i += 1;
      continue;
    }
    if (inSingle) {
      buf += ch;
      if (ch === "'") inSingle = false;
      i += 1;
      continue;
    }

    if (rest.startsWith('--')) {
      inLineComment = true;
      buf += ch;
      i += 1;
      continue;
    }
    if (rest.startsWith('/*')) {
      inBlockComment = true;
      buf += ch;
      i += 1;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      buf += ch;
      i += 1;
      continue;
    }
    const dollar = /^\$[A-Za-z_]*\$/.exec(rest);
    if (dollar) {
      dollarTag = dollar[0];
      buf += dollarTag;
      i += dollarTag.length;
      continue;
    }
    if (ch === ';') {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter((s) => s.replace(/--[^\n]*/g, '').trim().length > 0);
}

if (process.argv[1]?.includes('migrate')) {
  runMigrations()
    .then(() => {
      console.log('Migrations applied, views and append-only triggers installed.');
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
