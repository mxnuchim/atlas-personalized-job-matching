ALTER TABLE "runs" ADD COLUMN "sources_ok" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "sources_total" integer DEFAULT 0 NOT NULL;