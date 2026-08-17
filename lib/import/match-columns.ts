export const IMPORT_FIELDS = [
  'sourceId',
  'firstName',
  'lastName',
  'fullName',
  'subject',
  'status',
  'expectedMinutes',
  'guardianName',
  'guardianPhone',
  'releaseMode',
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

const SYNONYMS: Record<ImportField, string[]> = {
  sourceId: ['student id', 'studentid', 'id', 'student number', 'roll', 'roll number', 'enrollment id', 'member id', 'student no'],
  firstName: ['first name', 'first', 'given name', 'forename', 'fname', 'student first name', 'student first'],
  lastName: ['last name', 'last', 'surname', 'family name', 'lname', 'student last name', 'student last'],
  fullName: ['name', 'student name', 'student', 'full name', 'student full name', 'child name'],
  subject: ['subject', 'program', 'course', 'curriculum', 'subject enrolled', 'programme'],
  status: ['status', 'active', 'enrollment status', 'enrolled', 'state'],
  expectedMinutes: ['expected minutes', 'duration', 'session length', 'minutes', 'expected time'],
  guardianName: ['parent', 'guardian', 'parent name', 'guardian name', 'contact', 'contact name', 'mother', 'father', 'primary contact'],
  guardianPhone: ['phone', 'mobile', 'cell', 'contact number', 'telephone', 'parent phone', 'guardian phone', 'sms', 'phone number', 'contact phone'],
  releaseMode: ['release', 'release mode', 'pickup', 'pick up', 'dismissal'],
};

export function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Dice coefficient over character bigrams. ~20 lines, no dependency. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = (s: string) => {
    const out = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i += 1) {
      const g = s.slice(i, i + 2);
      out.set(g, (out.get(g) ?? 0) + 1);
    }
    return out;
  };
  const A = bigrams(a);
  const B = bigrams(b);
  let hits = 0;
  for (const [g, countA] of A) {
    const countB = B.get(g);
    if (countB) hits += Math.min(countA, countB);
  }
  const total = [...A.values()].reduce((x, y) => x + y, 0) + [...B.values()].reduce((x, y) => x + y, 0);
  return total === 0 ? 0 : (2 * hits) / total;
}

function scoreHeader(header: string, field: ImportField): number {
  const h = normalizeHeader(header);
  if (!h) return 0;
  let best = 0;
  for (const synonym of SYNONYMS[field]) {
    if (h === synonym) return 1;
    // "student first name" contains "first name" — a strong but not exact signal.
    if (h.includes(synonym) || synonym.includes(h)) best = Math.max(best, 0.85);
    best = Math.max(best, similarity(h, synonym));
  }
  return best;
}

export const MATCH_THRESHOLD = 0.72;

export type ColumnMapping = Partial<Record<ImportField, number>>;

/**
 * Greedy assignment with uniqueness: the strongest header/field pair wins first, and
 * neither that column nor that field can be claimed again. Without the uniqueness
 * constraint "Parent Phone" would win both guardianPhone and guardianName.
 */
export function matchColumns(headers: string[]): ColumnMapping {
  const candidates: { field: ImportField; column: number; score: number }[] = [];

  headers.forEach((header, column) => {
    for (const field of IMPORT_FIELDS) {
      const score = scoreHeader(header, field);
      if (score >= MATCH_THRESHOLD) candidates.push({ field, column, score });
    }
  });

  candidates.sort((a, b) => b.score - a.score);

  const mapping: ColumnMapping = {};
  const usedColumns = new Set<number>();
  const usedFields = new Set<ImportField>();

  for (const c of candidates) {
    if (usedColumns.has(c.column) || usedFields.has(c.field)) continue;
    mapping[c.field] = c.column;
    usedColumns.add(c.column);
    usedFields.add(c.field);
  }

  // A combined name column is only useful when the split columns are absent.
  if (mapping.firstName !== undefined && mapping.lastName !== undefined) {
    delete mapping.fullName;
  }

  return mapping;
}
