"use server";

import { AuthError } from "next-auth";
import { z } from "zod";

import { signIn } from "@/auth";
import { createUser, getUserByEmail } from "@/db/queries/users";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import { hashPassword } from "@/lib/password";
import { emailAllowed, signupOpen } from "@/lib/signup-allowlist";

/**
 * Creating an account.
 *
 * Invite-gated, and closed entirely when no code is configured. Atlas runs at a public
 * URL and every account spends the owner's model budget, so an open form is a funded
 * denial of wallet — not a theoretical one.
 */

const logger = log("signup");

const schema = z.object({
  name: z.string().trim().min(1, "What should we call you?").max(80),
  email: z.email("That does not look like an email address."),
  // Long, not complex: a length floor resists guessing better than a symbol rule, and
  // Argon2id handles the rest.
  password: z.string().min(10, "Use at least 10 characters."),
});

export type SignupState = { error?: string; fieldErrors?: Record<string, string> };

export async function signup(_prev: SignupState, formData: FormData): Promise<SignupState> {
  if (!signupOpen(env.SIGNUP_ALLOWED_EMAILS)) {
    return { error: "Signups are closed. Ask the owner of this Atlas to add your address." };
  }

  const parsed = schema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return { fieldErrors };
  }

  const { name, email, password } = parsed.data;
  const normalized = email.toLowerCase();

  if (!emailAllowed(normalized, env.SIGNUP_ALLOWED_EMAILS)) {
    return {
      error: "That address is not on the invite list for this Atlas.",
    };
  }
  if (await getUserByEmail(normalized)) {
    return { error: "An account with that email already exists. Sign in instead." };
  }

  await createUser({ email: normalized, passwordHash: await hashPassword(password), name });
  logger.info({ email: normalized }, "account created");

  try {
    // Straight into onboarding: an account with no profile can do nothing, so landing
    // on an empty Today would just be a dead end.
    await signIn("credentials", { email: normalized, password, redirectTo: "/profile" });
    return {};
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Account created, but sign-in failed. Try signing in." };
    }
    throw error;
  }
}
