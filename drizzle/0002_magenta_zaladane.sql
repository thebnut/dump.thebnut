ALTER TABLE "projects" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "projects_expires_at_idx" ON "projects" USING btree ("expires_at");