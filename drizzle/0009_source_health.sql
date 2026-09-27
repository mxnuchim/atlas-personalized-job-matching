ALTER TABLE "sources" ADD COLUMN "disabled_by" uuid;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "last_ok_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "last_error_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_disabled_by_users_id_fk" FOREIGN KEY ("disabled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;