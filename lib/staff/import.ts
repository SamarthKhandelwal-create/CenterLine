import 'server-only';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { db as defaultDb, type Db } from '@/db';
import { user as userT } from '@/db/schema';
import type { UserRole } from '@/db/schema';
import { generateTemporaryPassword, hashPassword } from '@/lib/auth/password';
import { detectHeaderRow, parseSpreadsheet } from '@/lib/import/parse';
import { normalizeHeader, similarity } from '@/lib/import/match-columns';
import { splitName, titleCase } from '@/lib/import/normalize';

export const STAFF_IMPORT_FIELDS = ['name', 'firstName', 'lastName', 'email', 'role'] as const;

export type StaffImportField = (typeof STAFF_IMPORT_FIELDS)[number];

const SYNONYMS: Record<StaffImportField, string[]> = {
  name: ['name', 'staff name', 'full name', 'employee name', 'staff member', 'person', 'display name', 'instructor name'],
  firstName: ['first name', 'first', 'given name', 'forename', 'fname'],
  lastName: ['last name', 'last', 'surname', 'family name', 'lname'],
  email: ['email', 'e mail', 'email address', 'work email', 'login', 'username', 'user name', 'account', 'sign in'],
  role: ['role', 'position', 'job title', 'title', 'access', 'permission', 'permissions', 'access level', 'level', 'staff type'],
};

export const STAFF_MATCH_THRESHOLD = 0.72;

export type StaffColumnMapping = Partial<Record<StaffImportField, number>>;

function scoreHeader(header: string, field: StaffImportField): number {
  const h = normalizeHeader(header);
  if (!h) return 0;
  let best = 0;
  for (const synonym of SYNONYMS[field]) {
    if (h === synonym) return 1;
    if (h.includes(synonym) || synonym.includes(h)) best = Math.max(best, 0.85);
    best = Math.max(best, similarity(h, synonym));
  }
  return best;
}

/** Same greedy unique assignment as the roster importer, over the staff fields. */
export function matchStaffColumns(headers: string[]): StaffColumnMapping {
  const candidates: { field: StaffImportField; column: number; score: number }[] = [];

  headers.forEach((header, column) => {
    for (const field of STAFF_IMPORT_FIELDS) {
      const score = scoreHeader(header, field);
      if (score >= STAFF_MATCH_THRESHOLD) candidates.push({ field, column, score });
    }
  });

  candidates.sort((a, b) => b.score - a.score);

  const mapping: StaffColumnMapping = {};
  const usedColumns = new Set<number>();
  const usedFields = new Set<StaffImportField>();

  for (const c of candidates) {
    if (usedColumns.has(c.column) || usedFields.has(c.field)) continue;
    mapping[c.field] = c.column;
    usedColumns.add(c.column);
    usedFields.add(c.field);
  }

  if (mapping.firstName !== undefined && mapping.lastName !== undefined) delete mapping.name;

  return mapping;
}

const INSTRUCTOR_WORDS = ['instructor', 'owner', 'manager', 'admin', 'director', 'principal', 'teacher', 'lead'];
const ASSISTANT_WORDS = ['assistant', 'aide', 'helper', 'tutor', 'intern', 'support', 'trainee', 'part time', 'parttime'];

/**
 * Roles from a spreadsheet, with assistant as the floor.
 *
 * `recognised: false` means the row is being imported as an assistant because nothing
 * in the cell was understood — not because the file said assistant. That difference is
 * surfaced as a warning in the review screen, because the two roles are not
 * cosmetic: an instructor sees the whole roster, the compliance record and every
 * guardian phone number. Guessing upward from an unfamiliar job title is the one
 * mistake this function must never make.
 */
export function normalizeRole(raw: string): { role: UserRole; recognised: boolean } {
  const v = raw.toLowerCase().trim();
  if (!v) return { role: 'assistant', recognised: false };

  const looksAssistant = ASSISTANT_WORDS.some((w) => v.includes(w));
  const looksInstructor = INSTRUCTOR_WORDS.some((w) => v.includes(w));

  // "Lead tutor" reads both ways. Least privilege, and say so.
  if (looksAssistant && looksInstructor) return { role: 'assistant', recognised: false };
  if (looksAssistant) return { role: 'assistant', recognised: true };
  if (looksInstructor) return { role: 'instructor', recognised: true };
  return { role: 'assistant', recognised: false };
}

/** Deliberately permissive — this rejects "not an address", not unusual addresses. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(value);
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export type StaffCandidate = {
  name: string;
  email: string;
  role: UserRole;
  roleRecognised: boolean;
  roleCell: string;
  rowNumber: number;
};

export type StaffImportItem = {
  action: 'new' | 'updated' | 'unchanged' | 'blocked';
  matchedUserId: string | null;
  candidate: StaffCandidate;
  changes: { field: string; from: string; to: string }[];
  /** Set on 'blocked': why this row cannot be applied at all. */
  blockedReason?: string;
  warnings: string[];
};

export type StaffImportPlan = {
  headerRowIndex: number;
  headers: string[];
  mapping: StaffColumnMapping;
  unmappedHeaders: string[];
  items: StaffImportItem[];
  counts: { new: number; updated: number; unchanged: number; blocked: number };
};

function cell(row: string[], index: number | undefined): string {
  if (index === undefined) return '';
  return row[index] ?? '';
}

/**
 * Rows -> candidate staff.
 *
 * One row per person, unlike the roster importer: staff do not have subjects, so there
 * is nothing to merge and a repeated email is a mistake in the file rather than a shape
 * to be understood.
 */
export function groupStaffRows(
  rows: string[][],
  mapping: StaffColumnMapping,
  headerRowIndex: number,
): StaffCandidate[] {
  const candidates: StaffCandidate[] = [];

  for (let i = headerRowIndex + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || row.every((c) => c === '')) continue;

    let name = titleCase(cell(row, mapping.name));
    const first = titleCase(cell(row, mapping.firstName));
    const last = titleCase(cell(row, mapping.lastName));
    if (first || last) {
      name = [first, last].filter(Boolean).join(' ');
    } else if (name.includes(',')) {
      const split = splitName(name);
      name = [split.firstName, split.lastName].filter(Boolean).join(' ');
    }

    const email = normalizeEmail(cell(row, mapping.email));
    const roleCell = cell(row, mapping.role);
    const { role, recognised } = normalizeRole(roleCell);

    // A row with neither a name nor an email is padding at the bottom of a sheet.
    if (!name && !email) continue;

    candidates.push({ name, email, role, roleRecognised: recognised, roleCell, rowNumber: i + 1 });
  }

  return candidates;
}

/**
 * Builds the review plan for a staff file.
 *
 * Matching is on email and nothing else. Staff names collide as readily as students'
 * do, but unlike a child a member of staff already has a globally unique identifier —
 * the address they sign in with — so there is no fuzzy cascade here and no ambiguous
 * outcome. A row whose email is not already in this centre is a new account, full stop.
 */
export async function analyzeStaffImport(
  centreId: string,
  fileBuffer: Buffer,
  db: Db = defaultDb,
): Promise<StaffImportPlan> {
  const rows = parseSpreadsheet(fileBuffer);
  if (rows.length === 0) throw new Error('That file has no rows in it.');

  const headerRowIndex = detectHeaderRow(rows);
  const headers = rows[headerRowIndex] ?? [];
  const mapping = matchStaffColumns(headers);

  if (mapping.email === undefined) {
    throw new Error(
      'No email column found. Staff are matched on the address they sign in with, so the file needs an "Email" column.',
    );
  }

  const candidates = groupStaffRows(rows, mapping, headerRowIndex);

  const existing = await db
    .select({ id: userT.id, name: userT.name, email: userT.email, role: userT.role })
    .from(userT)
    .where(eq(userT.centreId, centreId));
  const byEmail = new Map(existing.map((u) => [u.email.toLowerCase(), u]));

  // Emails are unique across the whole system, so an address belonging to another
  // centre cannot be claimed here — and an insert that tried would abort the entire
  // transaction. Only the addresses already in the file come back, and only the
  // address itself: no name, no id, nothing about who they are. That is the least
  // this can ask and still explain the refusal rather than failing the import.
  const fileEmails = [...new Set(candidates.map((c) => c.email).filter((e) => e !== ''))];
  const takenElsewhere = new Set<string>();
  if (fileEmails.length > 0) {
    const rowsElsewhere = await db
      .select({ email: userT.email })
      .from(userT)
      .where(
        and(ne(userT.centreId, centreId), inArray(sql`lower(${userT.email})`, fileEmails)),
      );
    for (const r of rowsElsewhere) takenElsewhere.add(r.email.toLowerCase());
  }

  const seen = new Map<string, number[]>();
  for (const c of candidates) {
    if (!c.email) continue;
    seen.set(c.email, [...(seen.get(c.email) ?? []), c.rowNumber]);
  }

  const items: StaffImportItem[] = candidates.map((candidate) => {
    const warnings: string[] = [];
    const blocked = (reason: string): StaffImportItem => ({
      action: 'blocked',
      matchedUserId: null,
      candidate,
      changes: [],
      blockedReason: reason,
      warnings,
    });

    if (!candidate.email) return blocked('No email address in this row.');
    if (!looksLikeEmail(candidate.email)) {
      return blocked(`"${candidate.email}" is not an email address.`);
    }

    const duplicateRows = seen.get(candidate.email) ?? [];
    if (duplicateRows.length > 1) {
      // Both copies are blocked rather than letting the last one silently win.
      return blocked(`This email appears on more than one row (${duplicateRows.join(', ')}).`);
    }

    if (takenElsewhere.has(candidate.email)) {
      return blocked('That email address already belongs to an account at another centre.');
    }

    if (!candidate.roleRecognised) {
      warnings.push(
        candidate.roleCell
          ? `Role "${candidate.roleCell}" was not recognised — importing as assistant.`
          : 'No role given — importing as assistant.',
      );
    }

    const match = byEmail.get(candidate.email);

    if (!match) {
      if (!candidate.name) return blocked('No name in this row, so the account cannot be created.');
      return { action: 'new', matchedUserId: null, candidate, changes: [], warnings };
    }

    const changes: { field: string; from: string; to: string }[] = [];
    // A blank name column on an existing person means "leave it alone", not "erase it".
    if (candidate.name && match.name !== candidate.name) {
      changes.push({ field: 'Name', from: match.name, to: candidate.name });
    }
    // An unrecognised role never demotes somebody who is already here. The default
    // exists to keep a new account small, not to strip an instructor on a file whose
    // role column said "Staff".
    if (candidate.roleRecognised && match.role !== candidate.role) {
      changes.push({ field: 'Role', from: match.role, to: candidate.role });
    }

    return {
      action: changes.length > 0 ? 'updated' : 'unchanged',
      matchedUserId: match.id,
      candidate,
      changes,
      warnings,
    };
  });

  const counts = {
    new: items.filter((i) => i.action === 'new').length,
    updated: items.filter((i) => i.action === 'updated').length,
    unchanged: items.filter((i) => i.action === 'unchanged').length,
    blocked: items.filter((i) => i.action === 'blocked').length,
  };

  const mappedColumns = new Set(Object.values(mapping));
  const unmappedHeaders = headers.filter((h, i) => h !== '' && !mappedColumns.has(i));

  return { headerRowIndex, headers, mapping, unmappedHeaders, items, counts };
}

export type StaffCommitResult = {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  blocked: number;
  /**
   * Shown once, never stored in plaintext and never recoverable afterwards — the same
   * posture as a QR card. A forgotten one is fixed by importing the person again after
   * an instructor resets them, not by looking it up.
   */
  newAccounts: { name: string; email: string; role: UserRole; temporaryPassword: string }[];
  /** Rows the database refused on principle, with the reason to show the instructor. */
  refused: { email: string; reason: string }[];
};

/**
 * Applies the plan in ONE transaction.
 *
 * Idempotency: re-importing the same file performs zero writes, because matching is on
 * a stored email rather than a name and 'unchanged' rows are never written.
 *
 * What this deliberately cannot do:
 *  - set or change a password (the file never carries one, and an existing account's
 *    hash is never touched — importing a colleague must not lock them out),
 *  - change an email address (it is the match key; a changed address is a new account),
 *  - remove anybody. `user` has no inactive state, so absence from the file means
 *    nothing at all. Deleting staff is not something a spreadsheet should be able to do
 *    silently — their shifts reference them.
 */
export async function commitStaffImport(
  args: {
    centreId: string;
    /** The instructor running the import. They cannot demote themselves. */
    actorUserId: string;
    plan: StaffImportPlan;
    /** Rows the instructor unticked in the review screen. */
    excluded?: number[];
  },
  db: Db = defaultDb,
): Promise<StaffCommitResult> {
  const excluded = new Set(args.excluded ?? []);
  const result: StaffCommitResult = {
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    blocked: 0,
    newAccounts: [],
    refused: [],
  };

  await db.transaction(async (tx) => {
    // Re-read from the database rather than trusting the plan: it made a round trip
    // through the browser between analyze and commit, and the roles in it decide who
    // can see this centre's roster.
    const current = await tx
      .select({ id: userT.id, email: userT.email, name: userT.name, role: userT.role })
      .from(userT)
      .where(eq(userT.centreId, args.centreId));
    const byEmail = new Map(current.map((u) => [u.email.toLowerCase(), u]));

    const applicable = args.plan.items
      .map((item, index) => ({ item, index }))
      .filter(({ item, index }) => !excluded.has(index) && item.action !== 'blocked');

    // Would this file leave the centre with nobody who can run it? Counted before any
    // write, over the whole plan, because the answer depends on every row at once.
    const instructorsNow = current.filter((u) => u.role === 'instructor').length;
    let demotions = 0;
    let promotions = 0;
    for (const { item } of applicable) {
      const target = item.candidate.role;
      const existing = byEmail.get(item.candidate.email);
      if (!item.candidate.roleRecognised && existing) continue;
      if (existing) {
        if (existing.role === 'instructor' && target === 'assistant') demotions += 1;
        if (existing.role === 'assistant' && target === 'instructor') promotions += 1;
      } else if (target === 'instructor') {
        promotions += 1;
      }
    }
    const wouldStrandTheCentre = instructorsNow - demotions + promotions < 1;

    for (const [index, item] of args.plan.items.entries()) {
      if (item.action === 'blocked') {
        result.blocked += 1;
        continue;
      }
      if (excluded.has(index)) {
        result.skipped += 1;
        continue;
      }

      const email = normalizeEmail(item.candidate.email);
      const existing = byEmail.get(email);

      if (!existing) {
        // Analyze said 'new'; the world may have moved on, but an address that is now
        // taken belongs to somebody, and inserting would abort the whole transaction.
        if (!item.candidate.name) {
          result.blocked += 1;
          continue;
        }
        const temporaryPassword = generateTemporaryPassword();
        await tx.insert(userT).values({
          centreId: args.centreId,
          email,
          name: item.candidate.name,
          role: item.candidate.role,
          passwordHash: await hashPassword(temporaryPassword),
        });
        result.created += 1;
        result.newAccounts.push({
          name: item.candidate.name,
          email,
          role: item.candidate.role,
          temporaryPassword,
        });
        continue;
      }

      const stored = existing;
      // A blank name column means "leave it alone", not "erase it".
      const nextName = item.candidate.name && item.candidate.name !== stored.name
        ? item.candidate.name
        : null;
      let nextRole: UserRole | null =
        item.candidate.roleRecognised && item.candidate.role !== stored.role
          ? item.candidate.role
          : null;

      if (nextRole === 'assistant' && stored.id === args.actorUserId) {
        // Signing your own demotion through a spreadsheet locks you out of the page
        // you are standing on. Someone else with the instructor role can do it.
        result.refused.push({ email, reason: 'You cannot change your own role in an import.' });
        nextRole = null;
      } else if (nextRole === 'assistant' && wouldStrandTheCentre) {
        result.refused.push({
          email,
          reason: 'This would leave the centre with no instructor.',
        });
        nextRole = null;
      }

      if (nextName === null && nextRole === null) {
        result.unchanged += 1;
        continue;
      }

      await tx
        .update(userT)
        .set({
          ...(nextName ? { name: nextName } : {}),
          ...(nextRole ? { role: nextRole } : {}),
        })
        .where(eq(userT.id, stored.id));

      // Keep the in-transaction view honest for the rows still to come.
      byEmail.set(email, {
        ...stored,
        name: nextName ?? stored.name,
        role: nextRole ?? stored.role,
      });
      result.updated += 1;
    }
  });

  return result;
}
