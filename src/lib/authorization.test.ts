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

/**
 * Actions that never take a row id from the caller, and so cannot reach across users.
 *
 * Each needs a reason, not just a path. An exemption list without reasons is how a
 * guard gets hollowed out one "just this once" at a time — and the reason is what a
 * reviewer checks when the file changes.
 */
const NOT_USER_SCOPED: Record<string, string> = {
  [join("app", "(app)", "actions.ts")]: "sign out — touches no row",
  [join("app", "(app)", "sources", "actions.ts")]: "sources are shared by every user",
  [join("app", "(app)", "today", "actions.ts")]: "triggers a run; owns no row",
  [join("app", "(app)", "profile", "actions.ts")]:
    "writes only the session user's own profile, via session.user.id — it accepts no row id",
  [join("app", "login", "actions.ts")]: "pre-auth by definition",
  [join("app", "signup", "actions.ts")]: "pre-auth by definition",
};

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

  it("every exemption names a file that exists", () => {
    // A stale exemption silently excuses a file that was renamed into scope.
    for (const rel of Object.keys(NOT_USER_SCOPED)) {
      expect(
        files.map((f) => relative(SRC, f)),
        rel,
      ).toContain(rel);
    }
  });

  it.each(
    actionFiles(join(SRC, "app"))
      .map((f) => relative(SRC, f))
      .filter((rel) => !(rel in NOT_USER_SCOPED)),
  )("%s establishes the acting principal", (rel) => {
    // `actingProfileId` for profile-owned rows (matches, drafts, outreach); `actingUserId`
    // for user-owned ones (resumes, which outlive profile re-imports). Either way the
    // owner is named by a helper, never read off the session ad hoc — and each pairs with
    // `getOwned*` fetches, which is where the ownership is actually enforced.
    const contents = readFileSync(join(SRC, rel), "utf8");
    expect(contents).toMatch(/\bactingProfileId\b|\bactingUserId\b/);
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
