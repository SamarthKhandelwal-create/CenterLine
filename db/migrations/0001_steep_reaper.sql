CREATE TABLE "compliance_attestation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"centre_id" uuid NOT NULL,
	"requirement_id" text NOT NULL,
	"confirmed_by" uuid,
	"confirmed_by_name" text NOT NULL,
	"note" text,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "compliance_attestation" ADD CONSTRAINT "compliance_attestation_centre_id_centre_id_fk" FOREIGN KEY ("centre_id") REFERENCES "public"."centre"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_attestation" ADD CONSTRAINT "compliance_attestation_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attestation_centre_req_idx" ON "compliance_attestation" USING btree ("centre_id","requirement_id","confirmed_at" DESC NULLS LAST);