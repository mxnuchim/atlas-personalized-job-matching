import "@/db/_bootstrap";

import { z } from "zod";

/**
 * Proves the provider seam is real rather than asserted: runs one identical Zod
 * schema through every provider that has a key, and reports pass/fail, tokens and
 * cost for each. Run with `npm run llm:smoke`.
 *
 * Costs a few fractions of a cent per provider. Not part of `npm test` — it makes
 * real network calls.
 */

const schema = z.object({
  city: z.string().describe("The capital city"),
  country: z.string().describe("The country it is the capital of"),
  founded_century: z.number().int().describe("Approximate century of founding, e.g. 3 for 3rd"),
});

const SYSTEM = "You answer with precise structured data. No commentary.";
const PROMPT = "Give me the capital of Japan.";

/** One sensible default per provider, from each provider's current model list. */
const DEFAULT_MODEL: Record<string, string> = {
  google: "gemini-3.8-flash",
  groq: "qwen/qwen3.8-27b",
  openai: "gpt-5-mini",
  anthropic: "claude-sonnet-5",
};

async function main() {
  // Imported after _bootstrap so env is loaded before the module parses it.
  const { configuredProviders } = await import("./config");
  const { generateStructured } = await import("./client");
  const { resolveModel } = await import("./config");

  const providers = configuredProviders();
  if (providers.length === 0) {
    console.error(
      "No provider keys found. Set at least one of ANTHROPIC/OPENAI/GEMINI/GROQ_API_KEY.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\nProviders with a key: ${providers.join(", ")}\n`);
  let failures = 0;

  for (const provider of providers) {
    const model = process.env[`SMOKE_MODEL_${provider.toUpperCase()}`] ?? DEFAULT_MODEL[provider]!;
    const started = Date.now();

    try {
      const { data, usage } = await generateStructured({
        schema,
        system: SYSTEM,
        prompt: PROMPT,
        model,
        maxRetries: 1,
        languageModel: resolveModel(model, provider),
      });

      const cost = usage.costUsd === null ? "unpriced" : `$${usage.costUsd.toFixed(6)}`;
      console.log(
        `  PASS  ${provider.padEnd(10)} ${model.padEnd(24)} ` +
          `${Date.now() - started}ms  in=${usage.inputTokens} out=${usage.outputTokens} ` +
          `cached=${usage.cachedInputTokens} ${cost}`,
      );
      console.log(`        → ${JSON.stringify(data)}`);
    } catch (error) {
      failures += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  FAIL  ${provider.padEnd(10)} ${model.padEnd(24)} ${message.split("\n")[0]}`);
    }
  }

  console.log(
    `\n${providers.length - failures}/${providers.length} providers returned schema-valid output.\n`,
  );
  // A provider without credits is expected to fail; don't fail the script for it.
}

void main();
