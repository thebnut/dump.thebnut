DROP INDEX "projects_expires_at_idx";--> statement-breakpoint
CREATE INDEX "projects_expires_at_idx" ON "projects" USING btree ("expires_at") WHERE "projects"."expires_at" IS NOT NULL;