import type { ReactNode } from "react";

import { AppNav } from "@/components/app-nav";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import { requireSession } from "@/lib/session";

export default async function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await requireSession();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-background/80 sticky top-0 z-30 border-b backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-primary">
              <Logo />
            </span>
            <span className="font-display text-sm font-semibold tracking-tight">Atlas</span>
          </div>

          <AppNav className="min-w-0 flex-1" />

          <div className="flex shrink-0 items-center gap-1">
            <ThemeToggle />
            <UserMenu name={session.user.name} email={session.user.email} />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
