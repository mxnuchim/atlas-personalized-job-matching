import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Logo } from "@/components/logo";
import { auth } from "@/auth";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/today");

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Logo className="size-6" />
          </span>
          <h1 className="font-display mt-4 text-2xl font-semibold tracking-tight">Atlas</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to your command center.</p>
        </div>

        <div className="rounded-xl border bg-card p-6">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
