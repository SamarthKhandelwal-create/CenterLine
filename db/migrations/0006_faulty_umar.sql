CREATE TABLE "student_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"centre_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"starts_at" time,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_schedule_weekday_range" CHECK ("student_schedule"."weekday" BETWEEN 0 AND 6)
);
--> statement-breakpoint
ALTER TABLE "student_schedule" ADD CONSTRAINT "student_schedule_centre_id_centre_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centre"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_schedule" ADD CONSTRAINT "student_schedule_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "student_schedule_one_per_day" ON "student_schedule" USING btree ("student_id","weekday");--> statement-breakpoint
CREATE INDEX "student_schedule_centre_weekday_idx" ON "student_schedule" USING btree ("centre_id","weekday");