CREATE TABLE "jd_requirements" (
	"hash" text PRIMARY KEY NOT NULL,
	"requirements" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "master_resumes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"source_text" text NOT NULL,
	"source_file_name" text,
	"source_mime" text,
	"content" jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resume_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tailored_resumes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid,
	"jd_hash" text NOT NULL,
	"jd_text" text NOT NULL,
	"title" text NOT NULL,
	"company" text,
	"master_id" uuid NOT NULL,
	"content" jsonb NOT NULL,
	"report" jsonb NOT NULL,
	"cover_letter" text,
	"cover_letter_warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text NOT NULL,
	"cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "master_resumes" ADD CONSTRAINT "master_resumes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_events" ADD CONSTRAINT "resume_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tailored_resumes" ADD CONSTRAINT "tailored_resumes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tailored_resumes" ADD CONSTRAINT "tailored_resumes_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tailored_resumes" ADD CONSTRAINT "tailored_resumes_master_id_master_resumes_id_fk" FOREIGN KEY ("master_id") REFERENCES "public"."master_resumes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "master_resumes_user_version_uq" ON "master_resumes" USING btree ("user_id","version");--> statement-breakpoint
CREATE INDEX "resume_events_user_created_idx" ON "resume_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tailored_resumes_user_job_uq" ON "tailored_resumes" USING btree ("user_id","job_id");--> statement-breakpoint
CREATE INDEX "tailored_resumes_user_updated_idx" ON "tailored_resumes" USING btree ("user_id","updated_at");