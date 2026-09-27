import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Logo } from "@/components/logo";
import { auth } from "@/auth";
import { listUsersForPicker } from "@/db/queries/users";
import { env } from "@/lib/env";
import { signupOpen } from "@/lib/signup-allowlist";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/today");

  const [users, inviteOpen] = await Promise.all([
    listUsersForPicker(),
    Promise.resolve(signupOpen(env.SIGNUP_ALLOWED_EMAILS)),
  ]);

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="bg-primary text-primary-foreground flex size-11 items-center justify-center rounded-xl">
            <Logo className="size-6" />
          </span>
          <h1 className="font-display mt-4 text-2xl font-semibold tracking-tight">Atlas</h1>
          <p className="text-muted-foreground mt-1 text-sm">Sign in to your command center.</p>
        </div>

        <div className="bg-card rounded-xl border p-6">
          <LoginForm users={users} />
        </div>

        {inviteOpen ? (
          <p className="text-muted-foreground mt-5 text-center text-sm">
            Don&rsquo;t have an account?{" "}
            <Link
              href="/signup"
              className="text-primary-ink rounded hover:underline focus-visible:ring-2 focus-visible:outline-none"
            >
              Sign up
            </Link>
          </p>
        ) : null}
      </div>
    </main>
  );
}
