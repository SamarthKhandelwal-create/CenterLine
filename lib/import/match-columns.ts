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
  // 'student no' is deliberately absent: it scores 0.80 against "Student Name" on
  // bigram similarity and would claim the name column as an id. 's no' and 'sr no'
  // cover the serial-number headers that shape was there for.
  sourceId: ['student id', 'studentid', 'id', 'student number', 'roll', 'roll number', 'enrollment id', 'member id', 's no', 'sr no', 'sl no'],
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
    // Matched on whole words, so a short synonym like "id" scores against "student id"
    // but not against "paid" or "grade id suffix".
    if (containsWords(h, synonym) || containsWords(synonym, h)) best = Math.max(best, 0.85);
    best = Math.max(best, similarity(h, synonym));
  }
  return best;
}

/** True when every word of `needle` appears consecutively as words of `haystack`. */
function containsWords(haystack: string, needle: string): boolean {
  if (!needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

export const MATCH_THRESHOLD = 0.72;

/**
 * Columns naming a subject that a per-row flag turns on, e.g. a "Math" and a "Read"
 * column each holding "Y". The tall shape (one row per student-subject) stays the
 * norm; this is the wide alternative real Kumon exports use.
 */
export type SubjectColumn = { column: number; subject: string };

export type ColumnMapping = Partial<Record<ImportField, number>> & {
  subjectColumns?: SubjectColumn[];
  /** Guardian name/phone pairs beyond the first, e.g. a mother's column set. */
  extraGuardians?: { name?: number; phone?: number }[];
};

/** Headers that name a subject outright rather than describing one. */
const SUBJECT_HEADERS: Record<string, string> = {
  math: 'Math',
  maths: 'Math',
  reading: 'Reading',
  read: 'Reading',
  english: 'Reading',
  japanese: 'Japanese',
};

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

  // Ties broken leftmost-first, so of two identical headers the earlier column wins
  // the field and the later one is left for the duplicate rule below.
  candidates.sort((a, b) => b.score - a.score || a.column - b.column);

  const mapping: ColumnMapping = {};
  const usedColumns = new Set<number>();
  const usedFields = new Set<ImportField>();

  // A header repeated in one file names the same kind of thing both times. Once the
  // first such column has taken its field, the duplicate must not cascade into a
  // weaker one: a second "Student Name" is another full name, not a first name.
  const claimedHeaders = new Set<string>();

  for (const c of candidates) {
    if (usedColumns.has(c.column) || usedFields.has(c.field)) continue;
    const header = normalizeHeader(headers[c.column] ?? '');
    if (claimedHeaders.has(header)) continue;
    mapping[c.field] = c.column;
    usedColumns.add(c.column);
    usedFields.add(c.field);
    claimedHeaders.add(header);
  }

  // A combined name column is only useful when the split columns are absent.
  if (mapping.firstName !== undefined && mapping.lastName !== undefined) {
    delete mapping.fullName;
  }

  // Wide subject columns. Only meaningful when there is no tall subject column, and
  // a header that already won another field (a "Reading Level" mapped elsewhere) is
  // left alone.
  if (mapping.subject === undefined) {
    const subjectColumns: SubjectColumn[] = [];
    headers.forEach((header, column) => {
      if (usedColumns.has(column)) return;
      const subject = SUBJECT_HEADERS[normalizeHeader(header)];
      if (subject) subjectColumns.push({ column, subject });
    });
    if (subjectColumns.length > 0) {
      mapping.subjectColumns = subjectColumns;
      for (const s of subjectColumns) usedColumns.add(s.column);
    }
  }

  // Further guardian blocks: a second "Cell" after the primary pair is the mother's
  // in these exports. Pairs are formed by walking the remaining name/phone headers in
  // column order so a name binds to the phone that follows it.
  const leftoverNames: number[] = [];
  const leftoverPhones: number[] = [];
  headers.forEach((header, column) => {
    if (usedColumns.has(column)) return;
    if (scoreHeader(header, 'guardianName') >= MATCH_THRESHOLD) leftoverNames.push(column);
    else if (scoreHeader(header, 'guardianPhone') >= MATCH_THRESHOLD) leftoverPhones.push(column);
  });

  if (leftoverNames.length > 0 || leftoverPhones.length > 0) {
    const extras: { name?: number; phone?: number }[] = [];
    for (const name of leftoverNames) {
      const phone = leftoverPhones.find((p) => p > name);
      if (phone !== undefined) leftoverPhones.splice(leftoverPhones.indexOf(phone), 1);
      extras.push({ name, phone });
    }
    for (const phone of leftoverPhones) extras.push({ phone });
    if (extras.length > 0) mapping.extraGuardians = extras;
  }

  return mapping;
}
