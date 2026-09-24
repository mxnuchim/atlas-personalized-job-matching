// Side-effect module for standalone scripts (seed, one-off tools) run via tsx
// outside Next.js, which does not auto-load .env.local. Import this FIRST, before
// any module that reads env. A missing file is a no-op and never overrides values
// already present in the environment.
import { config } from "dotenv";

config({ path: ".env.local" });
config();
