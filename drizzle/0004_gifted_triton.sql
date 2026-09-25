ALTER TYPE "public"."outreach_status" ADD VALUE 'bounced' BEFORE 'replied';--> statement-breakpoint
ALTER TABLE "outreach" ADD COLUMN "bounced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outreach" ADD COLUMN "gmail_thread_id" text;--> statement-breakpoint
ALTER TABLE "outreach" ADD COLUMN "gmail_message_id" text;