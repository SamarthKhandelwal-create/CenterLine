CREATE TYPE "public"."capture_method" AS ENUM('kiosk_qr', 'kiosk_pin', 'kiosk_tap', 'staff', 'inferred', 'manual');--> statement-breakpoint
CREATE TYPE "public"."credential_kind" AS ENUM('qr', 'pin');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('check_in', 'check_out');--> statement-breakpoint
CREATE TYPE "public"."release_mode" AS ENUM('guardian_pickup', 'self_release');--> statement-breakpoint
CREATE TYPE "public"."student_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('instructor', 'assistant');--> statement-breakpoint
CREATE TABLE "attendance_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"centre_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"type" "event_type" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"capture_method" "capture_method" NOT NULL,
	"inference_basis" text,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"supersedes_id" uuid
);
--> statement-breakpoint
CREATE TABLE "centre" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"phone" text,
	"close_time" time DEFAULT '19:00:00' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credential" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"centre_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"kind" "credential_kind" NOT NULL,
	"token_hash" text NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "guardian" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"centre_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"sms_consent" boolean DEFAULT false NOT NULL,
	"sms_consent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "message_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"centre_id" uuid NOT NULL,
	"guardian_id" uuid,
	"student_id" uuid,
	"template" text NOT NULL,
	"body" text NOT NULL,
	"status" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"centre_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_initial" text NOT NULL,
	"subjects" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"expected_minutes" integer DEFAULT 30 NOT NULL,
	"status" "student_status" DEFAULT 'active' NOT NULL,
	"release_mode" "release_mode" DEFAULT 'guardian_pickup' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_guardian" (
	"student_id" uuid NOT NULL,
	"guardian_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "student_guardian_student_id_guardian_id_pk" PRIMARY KEY("student_id","guardian_id")
);
--> statement-breakpoint
CREATE TABLE "student_import_key" (
	"centre_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"key_kind" text NOT NULL,
	"key_value" text NOT NULL,
	CONSTRAINT "student_import_key_centre_id_key_kind_key_value_pk" PRIMARY KEY("centre_id","key_kind","key_value")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"centre_id" uuid NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_event" ADD CONSTRAINT "attendance_event_centre_id_centre_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centre"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_event" ADD CONSTRAINT "attendance_event_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_event" ADD CONSTRAINT "attendance_event_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_event" ADD CONSTRAINT "attendance_event_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_centre_id_centre_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centre"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian" ADD CONSTRAINT "guardian_centre_id_centre_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centre"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_log" ADD CONSTRAINT "message_log_centre_id_centre_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centre"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_log" ADD CONSTRAINT "message_log_guardian_id_guardian_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."guardian"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_log" ADD CONSTRAINT "message_log_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student" ADD CONSTRAINT "student_centre_id_centre_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centre"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_guardian" ADD CONSTRAINT "student_guardian_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_guardian" ADD CONSTRAINT "student_guardian_guardian_id_guardian_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."guardian"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_import_key" ADD CONSTRAINT "student_import_key_centre_id_centre_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centre"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_import_key" ADD CONSTRAINT "student_import_key_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_centre_id_centre_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centre"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ae_student_occurred_idx" ON "attendance_event" USING btree ("student_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ae_centre_occurred_idx" ON "attendance_event" USING btree ("centre_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ae_supersedes_idx" ON "attendance_event" USING btree ("supersedes_id") WHERE "attendance_event"."supersedes_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "credential_token_hash_idx" ON "credential" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "credential_student_idx" ON "credential" USING btree ("student_id","kind");--> statement-breakpoint
CREATE INDEX "guardian_centre_phone_idx" ON "guardian" USING btree ("centre_id","phone");--> statement-breakpoint
CREATE INDEX "message_log_centre_sent_idx" ON "message_log" USING btree ("centre_id","sent_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "student_centre_status_idx" ON "student" USING btree ("centre_id","status");--> statement-breakpoint
CREATE INDEX "student_guardian_guardian_idx" ON "student_guardian" USING btree ("guardian_id");--> statement-breakpoint
CREATE INDEX "student_import_key_student_idx" ON "student_import_key" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_unique" ON "user" USING btree (lower("email"));