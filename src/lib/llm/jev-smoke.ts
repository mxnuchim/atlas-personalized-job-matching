import "@/db/_bootstrap";

import { evaluate, isEvaluationConfigured } from "./evaluate";

/**
 * Proves the Jev seam is real: one boolean evaluation through Vercel AI Gateway.
 * Run with `npm run llm:smoke:jev`. Costs a fraction of a cent.
 */
async function main() {
  if (!isEvaluationConfigured()) {
    console.error("AI_GATEWAY_API_KEY is not set — cannot reach Jev.");
    process.exit(1);
  }

  const result = await evaluate({
    state: "The support agent issued a full refund to the customer.",
    questions: {
      refunded: {
        type: "boolean",
        instructions: "Was a refund issued to the customer?",
        criteria: {
          true: "Money was returned to the customer.",
          false: "No refund was issued, or it was declined.",
        },
      },
    },
  });

  console.info("✓ Jev responded.");
  console.info("  refunded probability:", result.answers.refunded.probability);
  console.info("  input tokens:", result.usage.inputTokens);
  process.exit(0);
}

main().catch((error) => {
  console.error("Jev smoke failed:", error);
  process.exit(1);
});
