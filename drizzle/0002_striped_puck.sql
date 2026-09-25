ALTER TABLE "drafts" ADD COLUMN "evidence_id" uuid;--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "strength_keys" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE set null ON UPDATE no action;