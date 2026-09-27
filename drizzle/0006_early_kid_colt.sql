ALTER TABLE "jobs" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "jobs_open_idx" ON "jobs" USING btree ("closed_at");