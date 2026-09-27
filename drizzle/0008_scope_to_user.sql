-- Scope everything to a user.
--
-- Hand-written rather than generated: drizzle-kit cannot tell a rename from a
-- replacement here (integer `profile_version` → uuid `profile_id`), and its answer
-- either way is drop-then-add, which would orphan every match. The backfill below sits
-- between the add and the drop so nothing is lost.
--
-- Order matters twice over, and a dry run found both:
--   1. The backfill has to read `profile_version` before that column is dropped.
--   2. `profile_version_unique` cannot be dropped while the old foreign keys point at
--      it — Postgres refuses, because an FK depends on the index backing the unique.
--      So both FKs go first, then the constraint.

--> users: an avatar for the sign-in picker
ALTER TABLE "users" ADD COLUMN "image" text;--> statement-breakpoint

--> profile: owned by a user
ALTER TABLE "profile" ADD COLUMN "user_id" uuid;--> statement-breakpoint
-- The pre-existing profile belongs to the account seeded with it. With one user this
-- is exact; the NOT NULL below fails loudly rather than guessing if there is no user.
UPDATE "profile" SET "user_id" = (SELECT "id" FROM "users" ORDER BY "created_at" ASC LIMIT 1) WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "profile" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "profile" ADD CONSTRAINT "profile_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

--> add the new keys and backfill them while `profile_version` is still there
ALTER TABLE "strengths" ADD COLUMN "profile_id" uuid;--> statement-breakpoint
UPDATE "strengths" AS s SET "profile_id" = p."id" FROM "profile" AS p WHERE p."version" = s."profile_version";--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "profile_id" uuid;--> statement-breakpoint
UPDATE "matches" AS m SET "profile_id" = p."id" FROM "profile" AS p WHERE p."version" = m."profile_version";--> statement-breakpoint
-- A match whose profile version no longer exists was already unreachable; the old FK
-- would have cascaded it away. Removing it here keeps NOT NULL honest.
DELETE FROM "matches" WHERE "profile_id" IS NULL;--> statement-breakpoint

--> now the old foreign keys can go, which releases the unique they depend on
ALTER TABLE "strengths" DROP CONSTRAINT "strengths_profile_version_profile_version_fk";--> statement-breakpoint
ALTER TABLE "matches" DROP CONSTRAINT "matches_profile_version_profile_version_fk";--> statement-breakpoint
-- A version is unique per user now: two people both start at 1, and a global unique
-- would make the second person's first profile impossible.
ALTER TABLE "profile" DROP CONSTRAINT "profile_version_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "profile_user_version_uq" ON "profile" USING btree ("user_id","version");--> statement-breakpoint

--> finish strengths
ALTER TABLE "strengths" ALTER COLUMN "profile_id" SET NOT NULL;--> statement-breakpoint
DROP INDEX "strengths_version_key_uq";--> statement-breakpoint
ALTER TABLE "strengths" DROP COLUMN "profile_version";--> statement-breakpoint
ALTER TABLE "strengths" ADD CONSTRAINT "strengths_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "strengths_profile_key_uq" ON "strengths" USING btree ("profile_id","key");--> statement-breakpoint

--> finish matches
ALTER TABLE "matches" ALTER COLUMN "profile_id" SET NOT NULL;--> statement-breakpoint
DROP INDEX "matches_job_version_uq";--> statement-breakpoint
ALTER TABLE "matches" DROP COLUMN "profile_version";--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "matches_job_profile_uq" ON "matches" USING btree ("job_id","profile_id");
