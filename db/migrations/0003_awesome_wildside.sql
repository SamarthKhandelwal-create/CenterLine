CREATE TABLE "staff_shift" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"centre_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" uuid
);
--> statement-breakpoint
ALTER TABLE "staff_shift" ADD CONSTRAINT "staff_shift_centre_id_centre_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centre"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_shift" ADD CONSTRAINT "staff_shift_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_shift" ADD CONSTRAINT "staff_shift_ended_by_user_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_shift_centre_started_idx" ON "staff_shift" USING btree ("centre_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "staff_shift_one_open_per_user" ON "staff_shift" USING btree ("user_id") WHERE "staff_shift"."ended_at" IS NULL;