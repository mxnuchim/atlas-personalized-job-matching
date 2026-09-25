import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The LLM provider boundary (see src/lib/llm/index.ts). `src/lib/llm/**` is the only
  // place allowed to reach a provider; everything else goes through `@/lib/llm`.
  // boundary.test.ts covers the other half of the rule — bare API-key references.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/llm/**", "src/lib/gmail/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["ai", "@ai-sdk/*", "@anthropic-ai/*", "openai", "@google/*"],
              message:
                "Only src/lib/llm may import an LLM provider. Use generateStructured from @/lib/llm instead.",
            },
            {
              group: ["googleapis", "google-auth-library"],
              message:
                "Only src/lib/gmail may import the Google SDK. Use sendEmail from @/lib/gmail instead.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
