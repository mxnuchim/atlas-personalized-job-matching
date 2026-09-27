import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");

/**
 * Ownership guards, enforced structurally.
 *
 * `requireSession()` proves someone is signed in. It has never proved that the row
 * they named is theirs — which is how two accounts would have shared one review queue,
 * each able to approve and send the other's drafts.
 *
 * The fix is that a user-owned row is fetched *through* its owner (`getOwnedDraft`,
 * `getOwnedOutreach`, `ownsMatch`), so an action cannot obtain what it may not touch.
 * This test is the part that survives the next action someone adds in a hurry: a
 * reviewer will not notice a missing check, and a failing test will.
 */

/** Fetchers that take an id and no owner. Safe inside the pipeline, never in an action. */
const UNSCOPED_FETCHERS = ["getDraft", "getOutreach", "getOutreachForMatch"];

/** Actions that legitimately touch nothing a user owns. */
const NOT_USER_SCOPED = new Set([
  join("app", "(app)", "actions.ts"), // sign out
  join("app", "(app)", "sources", "actions.ts"), // sources are shared by everyone
  join("app", "(app)", "today", "actions.ts"), // triggers a run; owns no row
  join("app", "login", "actions.ts"), // pre-auth by definition
]);

function actionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return actionFiles(full);
    return entry === "actions.ts" ? [full] : [];
  });
}

describe("server actions cannot reach another user's rows", () => {
  const files = actionFiles(join(SRC, "app"));

  it("finds the action files it is supposed to be scanning", () => {
    // Guards against a silently-empty walk making everything below vacuous.
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  it.each(
    actionFiles(join(SRC, "app"))
      .map((f) => relative(SRC, f))
      .filter((rel) => !NOT_USER_SCOPED.has(rel)),
  )("%s establishes the acting profile", (rel) => {
    const contents = readFileSync(join(SRC, rel), "utf8");
    expect(contents).toContain("actingProfileId");
  });

  it.each(actionFiles(join(SRC, "app")).map((f) => relative(SRC, f)))(
    "%s does not fetch a user-owned row by bare id",
    (rel) => {
      const contents = readFileSync(join(SRC, rel), "utf8");
      const offenders = UNSCOPED_FETCHERS.filter((fn) =>
        // `getOwnedOutreach` contains "getOutreach", so match the call site exactly.
        new RegExp(`(^|[^A-Za-z])${fn}\\s*\\(`).test(contents),
      );
      expect(offenders).toEqual([]);
    },
  );
});
