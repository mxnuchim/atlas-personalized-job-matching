import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Enforces the hard rule: `src/lib/llm/` is the only place that may import the AI SDK,
 * a provider package, or reference an API key.
 *
 * ESLint's `no-restricted-imports` covers the imports; this test is what catches a
 * bare *key reference*, which is not an import and so invisible to the linter. If this
 * fails, the fix is never to widen the allowlist — route the call through `@/lib/llm`.
 */

const SRC = join(process.cwd(), "src");
const ALLOWED_DIR = join("lib", "llm");

const VIOLATIONS: { label: string; pattern: RegExp }[] = [
  { label: 'imports the AI SDK ("ai")', pattern: /from\s+["']ai["']|require\(["']ai["']\)/ },
  { label: "imports a provider package (@ai-sdk/*)", pattern: /["']@ai-sdk\// },
  {
    label: "imports a vendor SDK directly",
    pattern: /["']@anthropic-ai\/|["']openai["']|["']@google\//,
  },
  { label: "references an API key", pattern: /[A-Z0-9_]*_API_KEY\b/ },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

describe("LLM provider boundary", () => {
  it("keeps every provider import and API key inside src/lib/llm", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file);
      if (rel.startsWith(ALLOWED_DIR + sep)) continue;
      // env.ts declares the key names for validation; it never reaches a provider.
      if (rel === join("lib", "env.ts")) continue;

      const contents = readFileSync(file, "utf8");
      for (const { label, pattern } of VIOLATIONS) {
        if (pattern.test(contents)) offenders.push(`${rel} — ${label}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("finds the files it is supposed to be scanning", () => {
    // Guards against a silently-empty walk making the assertion above vacuous.
    expect(sourceFiles(SRC).length).toBeGreaterThan(30);
  });
});
