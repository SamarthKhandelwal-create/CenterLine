DROP INDEX "user_email_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "user_centre_email_unique" ON "user" USING btree ("centre_id",lower("email"));