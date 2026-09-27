import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { Logo } from "@/components/logo";
import { env } from "@/lib/env";
import { signupOpen } from "@/lib/signup-allowlist";

import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Create an account",
};

export default async function SignupPage() {
  const session = await auth();
  if (session?.user) redirect("/today");

  // Closed is the default. Rendering the form and rejecting on submit would waste
  // someone's time inventing a password for a door that is locked.
  const open = signupOpen(env.SIGNUP_ALLOWED_EMAILS);

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="bg-primary text-primary-foreground flex size-11 items-center justify-center rounded-xl">
            <Logo className="size-6" />
          </span>
          <h1 className="font-display mt-4 text-2xl font-semibold tracking-tight">
            {open ? "Create your account" : "Signups are closed"}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm text-pretty">
            {open
              ? "You'll set up your profile next — that's what the matching runs on."
              : "This Atlas is invite-only. Ask its owner to add your address."}
          </p>
        </div>

        {open ? (
          <div className="bg-card rounded-xl border p-6">
            <SignupForm />
          </div>
        ) : null}

        <p className="text-muted-foreground mt-5 text-center text-sm">
          Already have an account?{" "}
          <Link
            href="/login"
            className="text-primary-ink rounded hover:underline focus-visible:ring-2 focus-visible:outline-none"
          >
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
