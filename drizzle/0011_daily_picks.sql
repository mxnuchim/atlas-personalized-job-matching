CREATE TABLE "daily_picks" (
	"profile_id" uuid NOT NULL,
	"day" text NOT NULL,
	"lane" text NOT NULL,
	"match_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_picks_profile_id_day_match_id_pk" PRIMARY KEY("profile_id","day","match_id")
);
--> statement-breakpoint
ALTER TABLE "daily_picks" ADD CONSTRAINT "daily_picks_profile_id_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_picks" ADD CONSTRAINT "daily_picks_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "daily_picks_profile_day_lane_idx" ON "daily_picks" USING btree ("profile_id","day","lane");