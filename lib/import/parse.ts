import * as XLSX from 'xlsx';

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;

/**
 * Reads .xlsx, .xls and .csv through one API into a plain grid of strings.
 *
 * Parsing happens only on the server, with hard size and row caps — the SheetJS npm
 * build has known prototype-pollution advisories, and a roster file is untrusted
 * input that an instructor exported from software we do not control.
 */
export function parseSpreadsheet(buffer: ArrayBuffer | Buffer): string[][] {
  const data: Buffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(new Uint8Array(buffer));
  if (data.byteLength > MAX_IMPORT_BYTES) {
    throw new Error('That file is larger than 5 MB. Export just the roster and try again.');
  }

  const workbook = XLSX.read(data, { type: 'buffer', cellDates: false, cellFormula: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('That file has no sheets in it.');
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error('That file has no readable sheet.');

  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  });

  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`That file has more than ${MAX_IMPORT_ROWS} rows.`);
  }

  return rows.map((row) => (Array.isArray(row) ? row.map((cell) => normalizeCell(cell)) : []));
}

/** Excel leaves behind stray apostrophes, NBSPs and zero-width characters. */
export function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/^'/, '')
    // NBSP and friends -> ordinary space; zero-width characters -> nothing.
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const HEADER_HINTS = [
  'first', 'last', 'name', 'student', 'subject', 'program', 'course', 'phone', 'mobile',
  'cell', 'parent', 'guardian', 'contact', 'status', 'active', 'id', 'email', 'minutes',
  'grade', 'level', 'enrolled', 'enrollment',
];

function looksNumeric(cell: string): boolean {
  return cell !== '' && !Number.isNaN(Number(cell.replace(/[,$%]/g, '')));
}

/**
 * Finds the header row, which is often not row 1 — real exports carry a title banner,
 * a centre name, a generated-on date and a blank row before the actual headers.
 */
export function detectHeaderRow(rows: string[][]): number {
  let bestIndex = 0;
  let bestScore = -Infinity;
  const limit = Math.min(rows.length, 15);

  for (let i = 0; i < limit; i += 1) {
    const row = rows[i] ?? [];
    const nonEmpty = row.filter((c) => c !== '');
    if (nonEmpty.length < 2) continue;

    let score = 0;
    for (const cell of nonEmpty) {
      const lower = cell.toLowerCase();
      if (HEADER_HINTS.some((h) => lower.includes(h))) score += 2;
      if (looksNumeric(cell)) score -= 3;
      if (cell.length > 40) score -= 2;
    }
    score += nonEmpty.length;

    // Headers are followed by data with a comparable shape.
    const next = rows[i + 1] ?? [];
    const nextNonEmpty = next.filter((c) => c !== '').length;
    if (nextNonEmpty >= Math.max(2, nonEmpty.length - 1)) score += 2;

    // Duplicate labels in one row usually means it is data, not headers.
    const unique = new Set(nonEmpty.map((c) => c.toLowerCase()));
    if (unique.size < nonEmpty.length) score -= 2;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex;
}
