"use server";

import { AuthError } from "next-auth";

import { signIn } from "@/auth";

export type LoginState = { error?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/today",
    });
    return {};
  } catch (error) {
    // A successful signIn throws NEXT_REDIRECT — that must propagate.
    if (error instanceof AuthError) {
      return { error: "Wrong email or password." };
    }
    throw error;
  }
}
