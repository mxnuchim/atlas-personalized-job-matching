CREATE TYPE "public"."draft_status" AS ENUM('pending', 'approved', 'skipped', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."match_tier" AS ENUM('strong', 'possible', 'stretch');--> statement-breakpoint
CREATE TYPE "public"."outreach_channel" AS ENUM('email', 'apply_link');--> statement-breakpoint
CREATE TYPE "public"."outreach_status" AS ENUM('drafted', 'sent', 'replied', 'interview', 'offer', 'rejected', 'closed');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('ok', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('greenhouse', 'lever', 'ashby', 'rss', 'api');--> statement-breakpoint
CREATE TYPE "public"."strength_kind" AS ENUM('core', 'differentiator');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'admin');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text,
	"role" "user_role" DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "source_kind" NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"company" text NOT NULL,
	"location" text,
	"remote" boolean DEFAULT false NOT NULL,
	"url" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"posted_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"headline" text NOT NULL,
	"target_roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"seniority" text,
	"locations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"relocation" boolean DEFAULT false NOT NULL,
	"dealbreakers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cv_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "strengths" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_version" integer NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"kind" "strength_kind" NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strength_id" uuid NOT NULL,
	"claim" text NOT NULL,
	"context" text,
	"metric" text,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"profile_version" integer NOT NULL,
	"overall" integer NOT NULL,
	"tier" "match_tier" NOT NULL,
	"dimensions" jsonb NOT NULL,
	"strength_matches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"why_you" text NOT NULL,
	"reasoning" text NOT NULL,
	"red_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"scored_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"recipient" text,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"edited_body" text,
	"status" "draft_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "outreach" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"channel" "outreach_channel" DEFAULT 'email' NOT NULL,
	"status" "outreach_status" DEFAULT 'drafted' NOT NULL,
	"sent_at" timestamp with time zone,
	"replied_at" timestamp with time zone,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"jobs_seen" integer DEFAULT 0 NOT NULL,
	"new_jobs" integer DEFAULT 0 NOT NULL,
	"scored" integer DEFAULT 0 NOT NULL,
	"drafted" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"status" "run_status" DEFAULT 'ok' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strengths" ADD CONSTRAINT "strengths_profile_version_profile_version_fk" FOREIGN KEY ("profile_version") REFERENCES "public"."profile"("version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_strength_id_strengths_id_fk" FOREIGN KEY ("strength_id") REFERENCES "public"."strengths"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_profile_version_profile_version_fk" FOREIGN KEY ("profile_version") REFERENCES "public"."profile"("version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_source_external_uq" ON "jobs" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "jobs_company_idx" ON "jobs" USING btree ("company");--> statement-breakpoint
CREATE UNIQUE INDEX "strengths_version_key_uq" ON "strengths" USING btree ("profile_version","key");--> statement-breakpoint
CREATE UNIQUE INDEX "matches_job_version_uq" ON "matches" USING btree ("job_id","profile_version");