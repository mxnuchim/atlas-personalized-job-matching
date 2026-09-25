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

/** Each vendor boundary, and the one directory allowed to cross it. */
const BOUNDARIES: { dir: string; violations: { label: string; pattern: RegExp }[] }[] = [
  {
    dir: join("lib", "llm"),
    violations: [
      {
        label: 'imports the AI SDK ("ai")',
        pattern: /(?:from|require\()\s*["']ai["']/,
      },
      {
        label: "imports a provider package (@ai-sdk/*)",
        pattern: /(?:from|require\()\s*["']@ai-sdk\//,
      },
      {
        label: "imports a vendor SDK directly",
        pattern: /(?:from|require\()\s*["'](?:@anthropic-ai\/|openai|@google\/)/,
      },
    ],
  },
  {
    dir: join("lib", "gmail"),
    violations: [
      {
        label: "imports the Google SDK",
        pattern: /(?:from|require\()\s*["'](?:googleapis|google-auth-library)["']/,
      },
    ],
  },
];

/** Secrets belong to whichever layer owns them; env.ts only declares the names. */
const SECRET_PATTERN = {
  label: "references a secret",
  pattern: /[A-Z0-9_]*_API_KEY\b|GOOGLE_CLIENT_SECRET|GMAIL_OAUTH_REFRESH_TOKEN/,
};
const SECRET_DIRS = [join("lib", "llm"), join("lib", "gmail")];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

describe("vendor boundaries", () => {
  it.each(BOUNDARIES)("keeps $dir's vendor imports inside it", ({ dir, violations }) => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file);
      if (rel.startsWith(dir + sep)) continue;

      const contents = readFileSync(file, "utf8");
      for (const { label, pattern } of violations) {
        if (pattern.test(contents)) offenders.push(`${rel} — ${label}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps every secret inside the layer that owns it", () => {
    // This is the half a linter cannot see: a bare key reference is not an import.
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file);
      if (SECRET_DIRS.some((dir) => rel.startsWith(dir + sep))) continue;
      // env.ts declares the names for validation; it never reaches a vendor.
      if (rel === join("lib", "env.ts")) continue;

      if (SECRET_PATTERN.pattern.test(readFileSync(file, "utf8"))) {
        offenders.push(`${rel} — ${SECRET_PATTERN.label}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("finds the files it is supposed to be scanning", () => {
    // Guards against a silently-empty walk making the assertion above vacuous.
    expect(sourceFiles(SRC).length).toBeGreaterThan(30);
  });
});
