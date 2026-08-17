import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  time,
  primaryKey,
  index,
  uniqueIndex,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

export const userRole = pgEnum('user_role', ['instructor', 'assistant']);
export const studentStatus = pgEnum('student_status', ['active', 'inactive']);
export const releaseMode = pgEnum('release_mode', ['guardian_pickup', 'self_release']);
export const credentialKind = pgEnum('credential_kind', ['qr', 'pin']);
export const eventType = pgEnum('event_type', ['check_in', 'check_out']);
export const captureMethod = pgEnum('capture_method', [
  'kiosk_qr',
  'kiosk_pin',
  'kiosk_tap',
  'staff',
  'inferred',
  'manual',
]);

export const centre = pgTable('centre', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('America/New_York'),
  phone: text('phone'),
  closeTime: time('close_time').notNull().default('19:00:00'),
});

export const user = pgTable(
  'user',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    centreId: uuid('centre_id')
      .notNull()
      .references(() => centre.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: userRole('role').notNull(),
    name: text('name').notNull(),
  },
  (t) => [uniqueIndex('user_email_unique').on(sql`lower(${t.email})`)],
);

export const student = pgTable(
  'student',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    centreId: uuid('centre_id')
      .notNull()
      .references(() => centre.id, { onDelete: 'cascade' }),
    firstName: text('first_name').notNull(),
    lastInitial: text('last_initial').notNull(),
    subjects: text('subjects').array().notNull().default(sql`ARRAY[]::text[]`),
    expectedMinutes: integer('expected_minutes').notNull().default(30),
    status: studentStatus('status').notNull().default('active'),
    releaseMode: releaseMode('release_mode').notNull().default('guardian_pickup'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('student_centre_status_idx').on(t.centreId, t.status)],
);

export const guardian = pgTable(
  'guardian',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    centreId: uuid('centre_id')
      .notNull()
      .references(() => centre.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    smsConsent: boolean('sms_consent').notNull().default(false),
    smsConsentAt: timestamp('sms_consent_at', { withTimezone: true }),
  },
  (t) => [index('guardian_centre_phone_idx').on(t.centreId, t.phone)],
);

export const studentGuardian = pgTable(
  'student_guardian',
  {
    studentId: uuid('student_id')
      .notNull()
      .references(() => student.id, { onDelete: 'cascade' }),
    guardianId: uuid('guardian_id')
      .notNull()
      .references(() => guardian.id, { onDelete: 'cascade' }),
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.studentId, t.guardianId] }),
    index('student_guardian_guardian_idx').on(t.guardianId),
  ],
);

export const credential = pgTable(
  'credential',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    centreId: uuid('centre_id')
      .notNull()
      .references(() => centre.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => student.id, { onDelete: 'cascade' }),
    kind: credentialKind('kind').notNull(),
    tokenHash: text('token_hash').notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    index('credential_token_hash_idx').on(t.tokenHash),
    index('credential_student_idx').on(t.studentId, t.kind),
  ],
);

/**
 * APPEND ONLY. No UPDATE, no DELETE, ever — enforced by database triggers in
 * db/views.sql as well as by convention. A correction inserts a new row whose
 * supersedes_id points at the row it replaces.
 */
export const attendanceEvent = pgTable(
  'attendance_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    centreId: uuid('centre_id')
      .notNull()
      .references(() => centre.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => student.id, { onDelete: 'cascade' }),
    type: eventType('type').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    captureMethod: captureMethod('capture_method').notNull(),
    inferenceBasis: text('inference_basis'),
    confirmedBy: uuid('confirmed_by').references(() => user.id, { onDelete: 'set null' }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    supersedesId: uuid('supersedes_id'),
  },
  (t) => [
    index('ae_student_occurred_idx').on(t.studentId, t.occurredAt.desc()),
    index('ae_centre_occurred_idx').on(t.centreId, t.occurredAt.desc()),
    index('ae_supersedes_idx')
      .on(t.supersedesId)
      .where(sql`${t.supersedesId} IS NOT NULL`),
  ],
);

/**
 * Staff shifts — who was on the floor, and when.
 *
 * An ordinary table, unlike `attendance_event`: the append-only triggers cover student
 * attendance only, and clocking out is genuinely an update to the shift you started.
 * Student attendance is evidence for a compliance requirement; a staff shift is not,
 * so it does not need the same treatment.
 *
 * The partial unique index is the part that matters. Without it a double-tap on Clock
 * in leaves two open shifts and every duration afterwards is wrong; with it the second
 * insert is rejected by the database rather than by whoever remembers to check.
 */
export const staffShift = pgTable(
  'staff_shift',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    centreId: uuid('centre_id')
      .notNull()
      .references(() => centre.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    /** Null means on shift. */
    endedAt: timestamp('ended_at', { withTimezone: true }),
    /** Set when an instructor closes someone else's forgotten shift. */
    endedBy: uuid('ended_by').references(() => user.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('staff_shift_centre_started_idx').on(t.centreId, t.startedAt.desc()),
    uniqueIndex('staff_shift_one_open_per_user')
      .on(t.userId)
      .where(sql`${t.endedAt} IS NULL`),
  ],
);

export const messageLog = pgTable(
  'message_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    centreId: uuid('centre_id')
      .notNull()
      .references(() => centre.id, { onDelete: 'cascade' }),
    guardianId: uuid('guardian_id').references(() => guardian.id, { onDelete: 'set null' }),
    studentId: uuid('student_id').references(() => student.id, { onDelete: 'set null' }),
    template: text('template').notNull(),
    body: text('body').notNull(),
    status: text('status').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('message_log_centre_sent_idx').on(t.centreId, t.sentAt.desc())],
);

/**
 * Import provenance. Not part of the domain model — it exists so that a re-import
 * of the same file matches the same students and changes nothing. `first_name` +
 * `last_initial` is not unique in a 200-student centre, so matching needs a real key.
 */
export const studentImportKey = pgTable(
  'student_import_key',
  {
    centreId: uuid('centre_id')
      .notNull()
      .references(() => centre.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => student.id, { onDelete: 'cascade' }),
    keyKind: text('key_kind').notNull(),
    keyValue: text('key_value').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.centreId, t.keyKind, t.keyValue] }),
    index('student_import_key_student_idx').on(t.studentId),
  ],
);

/**
 * Annual certification. Requirements 4 (staff oversight and training) and 6 (backup
 * and data preservation) describe things the centre does, not things the attendance
 * log can prove — they are confirmed by a named person and re-confirmed each year.
 */
export const complianceAttestation = pgTable(
  'compliance_attestation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    centreId: uuid('centre_id')
      .notNull()
      .references(() => centre.id, { onDelete: 'cascade' }),
    requirementId: text('requirement_id').notNull(),
    confirmedBy: uuid('confirmed_by').references(() => user.id, { onDelete: 'set null' }),
    confirmedByName: text('confirmed_by_name').notNull(),
    note: text('note'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('attestation_centre_req_idx').on(t.centreId, t.requirementId, t.confirmedAt.desc())],
);

export const centreRelations = relations(centre, ({ many }) => ({
  users: many(user),
  students: many(student),
  guardians: many(guardian),
}));

export const studentRelations = relations(student, ({ one, many }) => ({
  centre: one(centre, { fields: [student.centreId], references: [centre.id] }),
  guardians: many(studentGuardian),
  credentials: many(credential),
  events: many(attendanceEvent),
}));

export const guardianRelations = relations(guardian, ({ one, many }) => ({
  centre: one(centre, { fields: [guardian.centreId], references: [centre.id] }),
  students: many(studentGuardian),
}));

export const studentGuardianRelations = relations(studentGuardian, ({ one }) => ({
  student: one(student, { fields: [studentGuardian.studentId], references: [student.id] }),
  guardian: one(guardian, { fields: [studentGuardian.guardianId], references: [guardian.id] }),
}));

export type Centre = typeof centre.$inferSelect;
export type User = typeof user.$inferSelect;
export type Student = typeof student.$inferSelect;
export type Guardian = typeof guardian.$inferSelect;
export type Credential = typeof credential.$inferSelect;
export type AttendanceEvent = typeof attendanceEvent.$inferSelect;
export type MessageLog = typeof messageLog.$inferSelect;
export type StaffShift = typeof staffShift.$inferSelect;
export type ComplianceAttestation = typeof complianceAttestation.$inferSelect;
export type EventType = (typeof eventType.enumValues)[number];
export type CaptureMethod = (typeof captureMethod.enumValues)[number];
export type UserRole = (typeof userRole.enumValues)[number];
