import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { AppShell, SIDEBAR_COOKIE } from "@/components/app-shell";
import { requireSession } from "@/lib/session";

export default async function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await requireSession();
  // Read the collapse preference server-side so the first paint is the right width.
  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "1";

  return (
    <AppShell
      user={{ name: session.user.name, email: session.user.email }}
      defaultCollapsed={collapsed}
    >
      {children}
    </AppShell>
  );
}
