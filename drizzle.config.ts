import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside Next.js, so load local env explicitly.
// A missing file is a no-op and never overrides values already in the environment (e.g. CI).
config({ path: ".env.local" });
config();

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  casing: "snake_case",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://atlas:atlas@localhost:5432/atlas",
  },
  strict: true,
  verbose: true,
});
