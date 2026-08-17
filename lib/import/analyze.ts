import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { db as defaultDb, type Db } from '@/db';
import {
  guardian as guardianT,
  student as studentT,
  studentGuardian,
  studentImportKey,
} from '@/db/schema';
import { expectedMinutesFor } from '@/lib/students/expected-minutes';
import { detectHeaderRow, parseSpreadsheet } from './parse';
import { matchColumns, type ColumnMapping } from './match-columns';
import {
  canonicalSubject,
  fullNameKey,
  lastInitialOf,
  normalizePhone,
  normalizeReleaseMode,
  normalizeStatus,
  splitName,
  titleCase,
} from './normalize';

export type CandidateStudent = {
  sourceId: string | null;
  firstName: string;
  lastName: string;
  lastInitial: string;
  subjects: string[];
  expectedMinutes: number | null;
  status: 'active' | 'inactive';
  releaseMode: 'guardian_pickup' | 'self_release' | null;
  guardianName: string | null;
  guardianPhone: string | null;
  rowNumbers: number[];
};

export type ImportItem = {
  action: 'new' | 'updated' | 'unchanged' | 'ambiguous';
  matchedStudentId: string | null;
  candidate: CandidateStudent;
  changes: { field: string; from: string; to: string }[];
  /** Populated for 'ambiguous': the instructor picks which student this row is. */
  options?: { id: string; label: string }[];
  /**
   * The allowance this row should end up with, resolved against the stored student:
   * the file's figure if it stated one, otherwise derived from the subject count.
   * Carried through to the commit so the number the instructor approved in the review
   * screen is exactly the number written. Absent on new and ambiguous rows, where
   * there is no stored student to resolve against.
   */
  resolvedExpectedMinutes?: number;
  warnings: string[];
};

export type ImportPlan = {
  headerRowIndex: number;
  headers: string[];
  mapping: ColumnMapping;
  unmappedHeaders: string[];
  items: ImportItem[];
  counts: { new: number; updated: number; unchanged: number; ambiguous: number };
};

function cell(row: string[], index: number | undefined): string {
  if (index === undefined) return '';
  return row[index] ?? '';
}

/**
 * Rows -> candidate students.
 *
 * One row per student-subject is the norm in Kumon exports: "Aiden Chen, Math" and
 * "Aiden Chen, Reading" are ONE student with two subjects. Rows are grouped by the
 * strongest identity available (source id, else normalised full name) and merged.
 */
export function groupRows(rows: string[][], mapping: ColumnMapping, headerRowIndex: number) {
  const groups = new Map<string, CandidateStudent>();
  const warnings: string[] = [];

  for (let i = headerRowIndex + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || row.every((c) => c === '')) continue;

    let firstName = titleCase(cell(row, mapping.firstName));
    let lastName = titleCase(cell(row, mapping.lastName));
    if (!firstName && !lastName) {
      const combined = cell(row, mapping.fullName);
      if (!combined) continue;
      const split = splitName(combined);
      firstName = split.firstName;
      lastName = split.lastName;
    } else if (!lastName && firstName.includes(',')) {
      const split = splitName(firstName);
      firstName = split.firstName;
      lastName = split.lastName;
    }
    if (!firstName) continue;

    const sourceId = cell(row, mapping.sourceId).trim() || null;
    const key = sourceId ? `id:${sourceId}` : `name:${fullNameKey(firstName, lastName)}`;

    const subject = canonicalSubject(cell(row, mapping.subject));
    const minutesRaw = cell(row, mapping.expectedMinutes);
    const minutes = minutesRaw && !Number.isNaN(Number(minutesRaw)) ? Number(minutesRaw) : null;
    const guardianName = cell(row, mapping.guardianName).trim() || null;
    const guardianPhone = cell(row, mapping.guardianPhone)
      ? normalizePhone(cell(row, mapping.guardianPhone))
      : null;
    const statusCell = cell(row, mapping.status);
    const releaseCell = cell(row, mapping.releaseMode);

    const existing = groups.get(key);
    if (existing) {
      if (subject && !existing.subjects.includes(subject)) existing.subjects.push(subject);
      existing.rowNumbers.push(i + 1);
      if (minutes !== null) existing.expectedMinutes = Math.max(existing.expectedMinutes ?? 0, minutes);
      if (guardianName && !existing.guardianName) existing.guardianName = guardianName;
      if (guardianPhone && !existing.guardianPhone) existing.guardianPhone = guardianPhone;
      if (statusCell) existing.status = normalizeStatus(statusCell);
      if (releaseCell) existing.releaseMode = normalizeReleaseMode(releaseCell) ?? existing.releaseMode;
      continue;
    }

    groups.set(key, {
      sourceId,
      firstName,
      lastName,
      lastInitial: lastInitialOf(lastName) || firstName.slice(0, 1).toUpperCase(),
      subjects: subject ? [subject] : [],
      expectedMinutes: minutes,
      status: statusCell ? normalizeStatus(statusCell) : 'active',
      releaseMode: releaseCell ? normalizeReleaseMode(releaseCell) : null,
      guardianName,
      guardianPhone,
      rowNumbers: [i + 1],
    });
  }

  // Sorting subjects is what makes the diff stable — otherwise the order rows happen
  // to appear in the file would flip the array and every re-import would read "updated".
  for (const candidate of groups.values()) candidate.subjects.sort();

  return { candidates: [...groups.values()], warnings };
}

function subjectsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort();
  const y = [...b].sort();
  return x.every((v, i) => v === y[i]);
}

/**
 * Builds the review plan: which rows are new, updated, unchanged, or genuinely
 * ambiguous. Matching cascade, strongest first:
 *   1. source id from the file, recorded on a previous import
 *   2. normalised full name, recorded on a previous import
 *   3. exactly one active student with that first name + last initial
 *   4. otherwise new
 * Two students sharing "Emma S." are never silently merged; they surface as ambiguous.
 */
export async function analyzeImport(
  centreId: string,
  fileBuffer: Buffer,
  db: Db = defaultDb,
): Promise<ImportPlan> {
  const rows = parseSpreadsheet(fileBuffer);
  if (rows.length === 0) throw new Error('That file has no rows in it.');

  const headerRowIndex = detectHeaderRow(rows);
  const headers = rows[headerRowIndex] ?? [];
  const mapping = matchColumns(headers);

  if (mapping.firstName === undefined && mapping.fullName === undefined) {
    throw new Error(
      'No name column found. The file needs a "First Name"/"Last Name" pair or a single "Name" column.',
    );
  }

  const { candidates } = groupRows(rows, mapping, headerRowIndex);

  const existingStudents = await db
    .select({
      id: studentT.id,
      firstName: studentT.firstName,
      lastInitial: studentT.lastInitial,
      subjects: studentT.subjects,
      expectedMinutes: studentT.expectedMinutes,
      status: studentT.status,
      releaseMode: studentT.releaseMode,
    })
    .from(studentT)
    .where(eq(studentT.centreId, centreId));

  const keys = await db
    .select({
      studentId: studentImportKey.studentId,
      keyKind: studentImportKey.keyKind,
      keyValue: studentImportKey.keyValue,
    })
    .from(studentImportKey)
    .where(eq(studentImportKey.centreId, centreId));

  const bySourceId = new Map<string, string>();
  const byFullName = new Map<string, string>();
  for (const k of keys) {
    if (k.keyKind === 'source_id') bySourceId.set(k.keyValue, k.studentId);
    if (k.keyKind === 'full_name') byFullName.set(k.keyValue, k.studentId);
  }

  const byId = new Map(existingStudents.map((s) => [s.id, s]));
  const byNameInitial = new Map<string, typeof existingStudents>();
  for (const s of existingStudents) {
    const key = `${s.firstName.toLowerCase()}|${s.lastInitial.toLowerCase()}`;
    const list = byNameInitial.get(key) ?? [];
    list.push(s);
    byNameInitial.set(key, list);
  }

  const guardianRows =
    existingStudents.length > 0
      ? await db
          .select({
            studentId: studentGuardian.studentId,
            name: guardianT.name,
            phone: guardianT.phone,
          })
          .from(studentGuardian)
          .innerJoin(guardianT, eq(guardianT.id, studentGuardian.guardianId))
          .where(
            and(
              eq(studentGuardian.isPrimary, true),
              inArray(
                studentGuardian.studentId,
                existingStudents.map((s) => s.id),
              ),
            ),
          )
      : [];
  const guardianByStudent = new Map(guardianRows.map((g) => [g.studentId, g]));

  const items: ImportItem[] = candidates.map((candidate) => {
    const warnings: string[] = [];
    let matchedId: string | null = null;
    let ambiguousOptions: { id: string; label: string }[] | undefined;

    if (candidate.sourceId && bySourceId.has(candidate.sourceId)) {
      matchedId = bySourceId.get(candidate.sourceId)!;
    } else {
      const nameKey = fullNameKey(candidate.firstName, candidate.lastName);
      if (byFullName.has(nameKey)) {
        matchedId = byFullName.get(nameKey)!;
      } else {
        const key = `${candidate.firstName.toLowerCase()}|${candidate.lastInitial.toLowerCase()}`;
        const possible = byNameInitial.get(key) ?? [];
        if (possible.length === 1) {
          matchedId = possible[0]!.id;
          warnings.push('Matched on first name and last initial.');
        } else if (possible.length > 1) {
          ambiguousOptions = possible.map((p) => ({
            id: p.id,
            label: `${p.firstName} ${p.lastInitial}. · ${(p.subjects ?? []).join(', ') || 'no subjects'}`,
          }));
        }
      }
    }

    if (!candidate.lastName) warnings.push('No surname in the file; matching is less certain.');

    if (ambiguousOptions) {
      return {
        action: 'ambiguous',
        matchedStudentId: null,
        candidate,
        changes: [],
        options: ambiguousOptions,
        warnings,
      };
    }

    if (!matchedId) {
      return { action: 'new', matchedStudentId: null, candidate, changes: [], warnings };
    }

    const existing = byId.get(matchedId);
    if (!existing) {
      return { action: 'new', matchedStudentId: null, candidate, changes: [], warnings };
    }

    const subjects = candidate.subjects.length > 0 ? candidate.subjects : (existing.subjects ?? []);
    const expected = candidate.expectedMinutes ?? expectedMinutesFor(subjects);
    const guardian = guardianByStudent.get(matchedId);

    const changes: { field: string; from: string; to: string }[] = [];
    if (existing.firstName !== candidate.firstName) {
      changes.push({ field: 'First name', from: existing.firstName, to: candidate.firstName });
    }
    if (existing.lastInitial !== candidate.lastInitial) {
      changes.push({ field: 'Last initial', from: existing.lastInitial, to: candidate.lastInitial });
    }
    if (!subjectsEqual(existing.subjects ?? [], subjects)) {
      changes.push({
        field: 'Subjects',
        from: (existing.subjects ?? []).join(', '),
        to: subjects.join(', '),
      });
    }
    // Reported whether the figure came from the file or was derived from the subject
    // count. Guarding this on an explicit minutes column meant a student who gained a
    // subject showed "Subjects Math → Math, Reading" and nothing else, then committed
    // with their old 30-minute allowance intact — and a roster whose only staleness was
    // the allowance reported as 'unchanged'.
    if (existing.expectedMinutes !== expected) {
      changes.push({
        field: 'Expected minutes',
        from: String(existing.expectedMinutes),
        to: String(expected),
      });
    }
    if (existing.status !== candidate.status) {
      changes.push({ field: 'Status', from: existing.status, to: candidate.status });
    }
    if (candidate.releaseMode && existing.releaseMode !== candidate.releaseMode) {
      changes.push({ field: 'Release', from: existing.releaseMode, to: candidate.releaseMode });
    }
    if (candidate.guardianName && guardian?.name !== candidate.guardianName) {
      changes.push({ field: 'Guardian', from: guardian?.name ?? '—', to: candidate.guardianName });
    }
    if (candidate.guardianPhone && normalizePhone(guardian?.phone ?? '') !== candidate.guardianPhone) {
      changes.push({ field: 'Guardian phone', from: guardian?.phone ?? '—', to: candidate.guardianPhone });
    }

    return {
      action: changes.length > 0 ? 'updated' : 'unchanged',
      matchedStudentId: matchedId,
      candidate,
      changes,
      resolvedExpectedMinutes: expected,
      warnings,
    };
  });

  const counts = {
    new: items.filter((i) => i.action === 'new').length,
    updated: items.filter((i) => i.action === 'updated').length,
    unchanged: items.filter((i) => i.action === 'unchanged').length,
    ambiguous: items.filter((i) => i.action === 'ambiguous').length,
  };

  const mappedColumns = new Set(Object.values(mapping));
  const unmappedHeaders = headers.filter((h, i) => h !== '' && !mappedColumns.has(i));

  return { headerRowIndex, headers, mapping, unmappedHeaders, items, counts };
}
