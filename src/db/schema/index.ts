// Barrel for the full schema. `src/db/index.ts` imports this as the Drizzle
// schema object; migrations and queries import individual tables from here.

export * from "./enums";
export * from "./json";
export * from "./users";
export * from "./sources";
export * from "./jobs";
export * from "./profile";
export * from "./strengths";
export * from "./evidence";
export * from "./matches";
export * from "./drafts";
export * from "./outreach";
export * from "./runs";
