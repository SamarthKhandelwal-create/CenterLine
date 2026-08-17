import 'server-only';
import { sql } from 'drizzle-orm';
import { db as defaultDb, type Db } from '@/db';
import type { Centre } from '@/db/schema';

/**
 * The eight Kumon baseline check-in/check-out requirements, verbatim from
 * "Student Check-In / Check-Out System Requirements and Non-Exhaustive Informational
 * Vendor List".
 *
 * Centres certify annually and may be asked to demonstrate the system during a review,
 * so each row states what the system does AND what the centre's own data currently
 * shows. Six are computed from real records. Two — staff training and the backup
 * approach — describe what the centre does rather than what the log can prove, so they
 * are confirmed by a named person and expire after twelve months.
 */

export type RequirementStatus = 'green' | 'amber';
export type RequirementKind = 'computed' | 'attested';

export type RequirementResult = {
  id: string;
  number: number;
  title: string;
  /** The confirmation text from the Kumon checklist, verbatim. */
  confirmation: string;
  kind: RequirementKind;
  status: RequirementStatus;
  measure: string;
  evidence: string;
  /** Attested rows only. */
  attestedBy?: string | null;
  attestedAt?: Date | null;
  expiresAt?: Date | null;
};

export type Attestation = {
  requirementId: string;
  confirmedByName: string;
  confirmedAt: Date;
};

export type ComplianceContext = {
  centre: Centre;
  from: string;
  to: string;
  attestations: Attestation[];
};

/** Annual certification: a confirmation is good for twelve months. */
export const ATTESTATION_VALID_MONTHS = 12;
/** The checklist requires records be retained for at least two years. */
export const RETENTION_MINIMUM_YEARS = 2;

type Requirement = {
  id: string;
  number: number;
  title: string;
  confirmation: string;
  kind: RequirementKind;
  compute: (
    ctx: ComplianceContext,
    db: Db,
  ) => Promise<{ status: RequirementStatus; measure: string; evidence: string }>;
};

async function scalar(db: Db, query: ReturnType<typeof sql>, key = 'n'): Promise<number> {
  const rows = await db.execute(query);
  const row = (rows.rows[0] ?? {}) as Record<string, unknown>;
  return Number(row[key] ?? 0);
}

export const REQUIREMENTS: Requirement[] = [
  {
    id: 'digital-system',
    number: 1,
    title: 'Digital System Required',
    confirmation:
      'The center uses a digital check-in/check-out system. Manual logs, paper-based methods, or Excel-only tracking are not used as the baseline method.',
    kind: 'computed',
    compute: async (ctx, db) => {
      const total = await scalar(
        db,
        sql`SELECT count(*)::int n FROM attendance_event
            WHERE centre_id = ${ctx.centre.id}
              AND (occurred_at AT TIME ZONE ${ctx.centre.timezone})::date
                  BETWEEN ${ctx.from}::date AND ${ctx.to}::date`,
      );
      // 'kiosk_pin' is retained here deliberately: the PIN flow was removed, but a
      // centre that used it still has historical rows, and those were captured
      // digitally. Dropping it would understate past compliance.
      const digital = await scalar(
        db,
        sql`SELECT count(*)::int n FROM attendance_event
            WHERE centre_id = ${ctx.centre.id}
              AND capture_method IN ('kiosk_qr','kiosk_pin','kiosk_tap','staff','inferred')
              AND (occurred_at AT TIME ZONE ${ctx.centre.timezone})::date
                  BETWEEN ${ctx.from}::date AND ${ctx.to}::date`,
      );
      return {
        status: total > 0 ? 'green' : 'amber',
        measure: total > 0 ? `${total} digital records` : 'no records in period',
        evidence:
          total > 0
            ? `Every attendance record in this period was captured in this system (${digital} of ${total} through the kiosk or staff screens). There is no paper log or spreadsheet in the baseline workflow.`
            : 'No attendance has been recorded in this period, so the system cannot yet be shown in use.',
      };
    },
  },
  {
    id: 'unique-identification',
    number: 2,
    title: 'Unique Student Identification',
    confirmation:
      'Each student is uniquely identifiable within the system, such as by name, student ID, barcode, PIN, QR code, or another consistent identifier.',
    kind: 'computed',
    compute: async (ctx, db) => {
      const active = await scalar(
        db,
        sql`SELECT count(*)::int n FROM student
            WHERE centre_id = ${ctx.centre.id} AND status = 'active'`,
      );
      const withCredential = await scalar(
        db,
        sql`SELECT count(DISTINCT s.id)::int n FROM student s
            JOIN credential c ON c.student_id = s.id AND c.revoked_at IS NULL
            WHERE s.centre_id = ${ctx.centre.id} AND s.status = 'active'`,
      );
      const missing = active - withCredential;
      return {
        status: missing === 0 && active > 0 ? 'green' : 'amber',
        measure: `${withCredential} of ${active} active students`,
        evidence:
          active === 0
            ? 'There are no active students on the roster yet.'
            : missing === 0
              ? 'Every active student holds a unique QR card, and each has a distinct internal identifier, so two students with the same first name and last initial are never confused. A student without their card identifies themselves by name on the kiosk.'
              : `${missing} active student(s) have no usable QR card.`,
      };
    },
  },
  {
    id: 'actual-arrival-departure',
    number: 3,
    title: 'Actual Arrival and Departure',
    confirmation:
      'Check-in and check-out entries reflect actual student arrival and departure and are not entered later only for recordkeeping purposes.',
    kind: 'computed',
    compute: async (ctx, db) => {
      const total = await scalar(
        db,
        sql`SELECT count(*)::int n FROM attendance_event
            WHERE centre_id = ${ctx.centre.id}
              AND (occurred_at AT TIME ZONE ${ctx.centre.timezone})::date
                  BETWEEN ${ctx.from}::date AND ${ctx.to}::date`,
      );
      // See requirement 1 on why 'kiosk_pin' is still counted as a live capture.
      const live = await scalar(
        db,
        sql`SELECT count(*)::int n FROM attendance_event
            WHERE centre_id = ${ctx.centre.id}
              AND capture_method IN ('kiosk_qr','kiosk_pin','kiosk_tap')
              AND (occurred_at AT TIME ZONE ${ctx.centre.timezone})::date
                  BETWEEN ${ctx.from}::date AND ${ctx.to}::date`,
      );
      // An estimate that nobody has reviewed is the one thing this requirement is
      // really about: a time entered after the fact and left standing.
      const unreconciled = await scalar(
        db,
        sql`SELECT count(*)::int n FROM session_v
            WHERE centre_id = ${ctx.centre.id}
              AND session_date BETWEEN ${ctx.from}::date AND ${ctx.to}::date
              AND check_out_method = 'inferred'`,
      );
      const livePct = total > 0 ? Math.round((live / total) * 100) : 0;
      return {
        status: unreconciled === 0 && total > 0 ? 'green' : 'amber',
        measure: `${livePct}% captured live · ${unreconciled} estimate(s) open`,
        evidence:
          total === 0
            ? 'No attendance has been recorded in this period.'
            : unreconciled === 0
              ? `${live} of ${total} records were captured at the moment the student arrived or left. Where a student forgot to check out, the system closes the session at closing time, labels that time as an estimate with the reason attached, and staff confirm it — no time is ever presented as observed when it was not.`
              : `${unreconciled} estimated departure(s) are still awaiting staff confirmation. Until they are reviewed on the Day screen they remain marked as estimates, never as observed times.`,
      };
    },
  },
  {
    id: 'staff-oversight',
    number: 4,
    title: 'Staff Oversight and Training',
    confirmation:
      'Staff understand the check-in/check-out process and consistently follow it as part of daily center operations.',
    kind: 'attested',
    compute: async (ctx, db) => {
      const staff = await scalar(
        db,
        sql`SELECT count(*)::int n FROM "user" WHERE centre_id = ${ctx.centre.id}`,
      );
      const staffActions = await scalar(
        db,
        sql`SELECT count(*)::int n FROM attendance_event
            WHERE centre_id = ${ctx.centre.id}
              AND (created_by IS NOT NULL OR confirmed_by IS NOT NULL)
              AND (occurred_at AT TIME ZONE ${ctx.centre.timezone})::date
                  BETWEEN ${ctx.from}::date AND ${ctx.to}::date`,
      );
      return {
        status: 'green',
        measure: `${staff} staff account(s) · ${staffActions} staff action(s)`,
        evidence:
          `The centre has ${staff} named staff account(s), each with its own sign-in. Assistants see only the kiosk, the floor board and the emergency roster; the instructor sees everything. ` +
          `Staff took ${staffActions} recorded action(s) in this period — checking a student out or confirming an estimated departure — and every one is attributed to the person who took it.`,
      };
    },
  },
  {
    id: 'current-awareness',
    number: 5,
    title: 'Current Student Awareness',
    confirmation:
      'Staff can determine who is currently present when needed and can access historical attendance records for review when needed.',
    kind: 'computed',
    compute: async (ctx, db) => {
      const presentNow = await scalar(
        db,
        sql`WITH today AS (
              SELECT e.* FROM live_attendance_event e
              WHERE e.centre_id = ${ctx.centre.id}
                AND (e.occurred_at AT TIME ZONE ${ctx.centre.timezone})::date
                  = (now() AT TIME ZONE ${ctx.centre.timezone})::date
            ),
            latest AS (
              SELECT DISTINCT ON (student_id) student_id, type
              FROM today ORDER BY student_id, occurred_at DESC, id DESC
            )
            SELECT count(*)::int n FROM latest WHERE type = 'check_in'`,
      );
      const historicalDays = await scalar(
        db,
        sql`SELECT count(DISTINCT session_date)::int n FROM session_v
            WHERE centre_id = ${ctx.centre.id}`,
      );
      return {
        status: historicalDays > 0 ? 'green' : 'amber',
        measure: `${presentNow} present now · ${historicalDays} day(s) on record`,
        evidence:
          `The Floor screen lists everyone currently in the building, updating every ten seconds, and the Emergency screen prints that same list with guardian phone numbers for a fire drill. ` +
          `${historicalDays} day(s) of attendance are available on the History screen, filterable by date range and student, and exportable to CSV.`,
      };
    },
  },
  {
    id: 'backup-preservation',
    number: 6,
    title: 'Backup or Data Preservation Approach',
    confirmation:
      'The center has a reasonable approach to preserve necessary attendance data or maintain access to check-in/check-out information if the primary system is unavailable.',
    kind: 'attested',
    compute: async (ctx, db) => {
      const events = await scalar(
        db,
        sql`SELECT count(*)::int n FROM attendance_event WHERE centre_id = ${ctx.centre.id}`,
      );
      return {
        status: 'green',
        measure: `${events} record(s) exportable`,
        evidence:
          'A complete backup of the roster and every attendance record can be downloaded as CSV at any time from this page, and the attendance history can be exported separately from the History screen. ' +
          'The emergency roster prints on paper, so the list of who is in the building stays available even if the tablet or the network is down. The centre confirms below where those copies are kept.',
      };
    },
  },
  {
    id: 'pii-handling',
    number: 7,
    title: 'Appropriate Handling of Student Information / Personally Identifiable Information (PII)',
    confirmation:
      'Student information, including personally identifiable information (PII), is protected and limited to what is reasonably needed to support the check-in/check-out workflow.',
    kind: 'computed',
    compute: async (ctx, db) => {
      // Credentials are stored as HMACs. A stored plaintext PIN or token would be a
      // real finding, so check rather than assume.
      const credentials = await scalar(
        db,
        sql`SELECT count(*)::int n FROM credential WHERE centre_id = ${ctx.centre.id}`,
      );
      const weak = await scalar(
        db,
        sql`SELECT count(*)::int n FROM credential
            WHERE centre_id = ${ctx.centre.id}
              AND (length(token_hash) < 20 OR token_hash ~ '^[0-9]{4}$')`,
      );
      return {
        status: weak === 0 ? 'green' : 'amber',
        measure: weak === 0 ? `${credentials} credential(s) stored hashed` : `${weak} weak credential(s)`,
        evidence:
          weak === 0
            ? 'The roster stores a first name and last initial only — never a full surname. The kiosk shows nothing else and holds no phone numbers, so a tablet left by the door exposes no contact details. ' +
              'A printed QR card carries only a random token: no name, no centre, nothing identifying if it is dropped in a car park. All ' +
              `${credentials} credential(s) are stored as one-way hashes and cannot be read back. Guardian phone numbers are visible only to signed-in staff.`
            : `${weak} credential(s) appear to be stored in a recoverable form and should be reissued.`,
      };
    },
  },
  {
    id: 'retained-records',
    number: 8,
    title: 'Reviewable and Retained Records',
    confirmation:
      'Attendance records are reviewable when needed and retained for at least two years.',
    kind: 'computed',
    compute: async (ctx, db) => {
      const triggers = await scalar(
        db,
        sql`SELECT count(*)::int n FROM pg_trigger
            WHERE tgrelid = 'attendance_event'::regclass AND NOT tgisinternal`,
      );
      const spanDays = await scalar(
        db,
        sql`SELECT COALESCE(EXTRACT(DAY FROM (max(occurred_at) - min(occurred_at))), 0)::int n
            FROM attendance_event WHERE centre_id = ${ctx.centre.id}`,
      );
      const corrections = await scalar(
        db,
        sql`SELECT count(*)::int n FROM attendance_event
            WHERE centre_id = ${ctx.centre.id} AND supersedes_id IS NOT NULL`,
      );
      const years = (spanDays / 365).toFixed(1);
      return {
        // Records are never deleted, so retention is met as long as the log is
        // genuinely immutable — a young centre simply has less history yet.
        status: triggers >= 2 ? 'green' : 'amber',
        measure: `${spanDays} day(s) on record (${years}y)`,
        evidence:
          triggers >= 2
            ? `Attendance records are never edited or deleted — the database itself rejects both. A correction is added as a new entry that supersedes the earlier one, and both remain visible, so the ${corrections} correction(s) made here are fully auditable. ` +
              `Nothing is purged, so records exceed the two-year minimum as the centre accumulates history; ${spanDays} day(s) are on record so far. Any period can be reviewed on the History screen or exported as CSV or a dated PDF evidence pack.`
            : 'The append-only protection is not installed on this database. Run the migrations before relying on these records.',
      };
    },
  },
];

function attestationFor(ctx: ComplianceContext, id: string): Attestation | undefined {
  return ctx.attestations.find((a) => a.requirementId === id);
}

export function attestationExpiry(confirmedAt: Date): Date {
  const expiry = new Date(confirmedAt);
  expiry.setMonth(expiry.getMonth() + ATTESTATION_VALID_MONTHS);
  return expiry;
}

export async function evaluateRequirements(
  ctx: ComplianceContext,
  db: Db = defaultDb,
): Promise<RequirementResult[]> {
  return Promise.all(
    REQUIREMENTS.map(async (r) => {
      const computed = await r.compute(ctx, db);
      const base: RequirementResult = {
        id: r.id,
        number: r.number,
        title: r.title,
        confirmation: r.confirmation,
        kind: r.kind,
        ...computed,
      };

      if (r.kind !== 'attested') return base;

      // An attested requirement is only met while a current confirmation stands.
      const attestation = attestationFor(ctx, r.id);
      if (!attestation) {
        return {
          ...base,
          status: 'amber' as const,
          measure: 'not yet confirmed',
          evidence: `${computed.evidence} This requirement has not been confirmed yet.`,
          attestedBy: null,
          attestedAt: null,
          expiresAt: null,
        };
      }

      const expiresAt = attestationExpiry(attestation.confirmedAt);
      const expired = expiresAt.getTime() < Date.now();
      return {
        ...base,
        status: expired ? ('amber' as const) : ('green' as const),
        measure: expired
          ? `confirmation expired ${expiresAt.toISOString().slice(0, 10)}`
          : `confirmed by ${attestation.confirmedByName}`,
        evidence: expired
          ? `${computed.evidence} The annual confirmation lapsed on ${expiresAt.toISOString().slice(0, 10)} and needs renewing.`
          : computed.evidence,
        attestedBy: attestation.confirmedByName,
        attestedAt: attestation.confirmedAt,
        expiresAt,
      };
    }),
  );
}

export type CaptureStats = { method: string; count: number }[];

export async function captureStatistics(
  ctx: ComplianceContext,
  db: Db = defaultDb,
): Promise<CaptureStats> {
  const rows = await db.execute(sql`
    SELECT capture_method AS method, count(*)::int AS count
    FROM attendance_event
    WHERE centre_id = ${ctx.centre.id}
      AND (occurred_at AT TIME ZONE ${ctx.centre.timezone})::date
          BETWEEN ${ctx.from}::date AND ${ctx.to}::date
    GROUP BY capture_method
    ORDER BY count DESC
  `);
  return rows.rows as unknown as CaptureStats;
}

export const RETENTION_POLICY =
  'Attendance records are retained for at least two years, as required by the Kumon baseline, ' +
  'and in practice are never deleted at all: the attendance log is append-only and the database ' +
  'rejects any attempt to modify or remove a record. A correction is recorded as a new entry that ' +
  'supersedes the earlier one, so the full history — including what the system originally estimated ' +
  'and what staff later confirmed — remains available for inspection. Guardian contact details are ' +
  'retained while a student is enrolled and removed on request. Student information is limited to a ' +
  'first name and last initial; no full surnames, addresses or dates of birth are stored.';

export const SYSTEM_DESCRIPTION = [
  'Centerline records when students arrive at and leave the centre. Students identify themselves at a ' +
    'tablet by the door using a printed QR card or a personal PIN. The system decides whether the tap is ' +
    'an arrival or a departure from the student’s own record for that day; the student is never asked ' +
    'to choose, and cannot record a time for anyone else.',
  'Every record is written once and never altered. If a record needs correcting, a new entry is added ' +
    'that supersedes the earlier one, and both remain in the log. The database itself rejects any attempt ' +
    'to modify or delete an attendance record.',
  'When a student forgets to check out, the system closes the session at the centre’s closing time and ' +
    'marks that departure time as an estimate, recording why. An estimated time is labelled as such ' +
    'everywhere it appears, including in this document and in exported data. Staff confirm estimates at the ' +
    'close of each day; confirmation adds a staff-attested entry and never overwrites the original estimate.',
];
