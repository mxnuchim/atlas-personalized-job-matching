import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
    env: {
      // Exercises the same path `next build` takes in CI: the real schema runs with
      // build placeholders, so every default applies and no real secret is needed.
      SKIP_ENV_VALIDATION: "1",
      LOG_LEVEL: "silent",
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Vitest resolves without the `react-server` condition, so the real module
      // throws by design. Point at the package's own empty variant instead.
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
});
