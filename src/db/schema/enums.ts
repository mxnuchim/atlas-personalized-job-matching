import { pgEnum } from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["owner", "admin"]);

export const sourceKind = pgEnum("source_kind", ["greenhouse", "lever", "ashby", "rss", "api"]);

export const strengthKind = pgEnum("strength_kind", ["core", "differentiator"]);

export const matchTier = pgEnum("match_tier", ["strong", "possible", "stretch"]);

export const draftStatus = pgEnum("draft_status", [
  "pending",
  "approved",
  "skipped",
  "sent",
  "failed",
]);

export const outreachChannel = pgEnum("outreach_channel", ["email", "apply_link"]);

export const outreachStatus = pgEnum("outreach_status", [
  "drafted",
  "sent",
  // Terminal and distinct from a rejection: the message never reached a person, so it
  // counts against the §11 bounce budget rather than against the funnel.
  "bounced",
  "replied",
  "interview",
  "offer",
  "rejected",
  "closed",
]);

export const runStatus = pgEnum("run_status", ["ok", "partial", "failed"]);
