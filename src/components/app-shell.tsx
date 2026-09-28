"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { Dialog } from "radix-ui";
import {
  ActivityIcon,
  BriefcaseIcon,
  GitBranchIcon,
  InboxIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  MenuIcon,
  PanelLeftIcon,
  RssIcon,
  SettingsIcon,
  TargetIcon,
  UserIcon,
} from "lucide-react";

import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon };

const NAV: NavItem[] = [
  { href: "/today", label: "Today", icon: LayoutDashboardIcon },
  { href: "/jobs", label: "Jobs", icon: BriefcaseIcon },
  { href: "/matches", label: "Matches", icon: TargetIcon },
  { href: "/review", label: "Review", icon: InboxIcon },
  { href: "/pipeline", label: "Pipeline", icon: GitBranchIcon },
  { href: "/sources", label: "Sources", icon: RssIcon },
  { href: "/runs", label: "Runs", icon: ActivityIcon },
  { href: "/profile", label: "Profile", icon: UserIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

/** Read on the server (layout) so the first paint is already the right width — no flash. */
export const SIDEBAR_COOKIE = "atlas_sidebar";
const EXPANDED = 240;
const COLLAPSED = 68;

type User = { name?: string | null; email?: string | null };

export function AppShell({
  user,
  defaultCollapsed,
  children,
}: {
  user: User;
  defaultCollapsed: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    // Persist to a cookie so the server renders the same width next load (no flash, and
    // no localStorage read-in-effect). A year, path-wide, lax.
    try {
      document.cookie = `${SIDEBAR_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      /* ignore */
    }
  }

  const width = collapsed ? COLLAPSED : EXPANDED;

  return (
    <div className="min-h-dvh" style={{ ["--sidebar-w" as string]: `${width}px` }}>
      {/* Desktop rail: fixed, width-animated. Hidden on mobile in favour of the drawer. */}
      <aside
        className="bg-card fixed inset-y-0 left-0 z-30 hidden border-r duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] [transition-property:width] md:flex md:flex-col"
        style={{ width }}
      >
        <SidebarBody
          collapsed={collapsed}
          pathname={pathname}
          user={user}
          onToggle={toggleCollapsed}
        />
      </aside>

      {/* Mobile top bar with the menu trigger. */}
      <header className="bg-background/80 sticky top-0 z-20 flex h-14 items-center gap-3 border-b px-4 backdrop-blur md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring -ml-2 rounded-md p-2 transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <MenuIcon className="size-5" />
        </button>
        <Link href="/today" className="flex items-center gap-2">
          <span className="text-primary">
            <Logo />
          </span>
          <span className="font-display text-sm font-semibold tracking-tight">Atlas</span>
        </Link>
      </header>

      {/* Mobile drawer: the same nav, always expanded, as a left sheet. */}
      <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] md:hidden" />
          <Dialog.Content
            aria-describedby={undefined}
            className="bg-card data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r duration-200 outline-none md:hidden"
          >
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <SidebarBody
              collapsed={false}
              pathname={pathname}
              user={user}
              animatePill={false}
              onNavigate={() => setMobileOpen(false)}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Content: left offset tracks the rail width on desktop only. */}
      <div className="duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] [transition-property:padding] md:pl-[var(--sidebar-w)]">
        <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
      </div>
    </div>
  );
}

function SidebarBody({
  collapsed,
  pathname,
  user,
  onToggle,
  onNavigate,
  animatePill = true,
}: {
  collapsed: boolean;
  pathname: string;
  user: User;
  onToggle?: () => void;
  onNavigate?: () => void;
  animatePill?: boolean;
}) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <div className="flex h-14 shrink-0 items-center gap-2 px-3">
        <Link
          href="/today"
          onClick={onNavigate}
          className="flex min-w-0 items-center gap-2 px-1"
        >
          <span className="text-primary shrink-0">
            <Logo />
          </span>
          {!collapsed && (
            <span className="font-display truncate text-sm font-semibold tracking-tight">Atlas</span>
          )}
        </Link>
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="text-muted-foreground hover:text-foreground hover:bg-secondary focus-visible:ring-ring ml-auto rounded-md p-1.5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <PanelLeftIcon className="size-4" />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2" aria-label="Primary">
        {NAV.map((item) => (
          <NavRow
            key={item.href}
            item={item}
            active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
            collapsed={collapsed}
            animatePill={animatePill}
            onNavigate={onNavigate}
          />
        ))}
      </nav>

      <div className="shrink-0 border-t p-3">
        <div className={cn("flex items-center gap-2", collapsed && "flex-col")}>
          <UserMenu name={user.name} email={user.email} collapsed={collapsed} />
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}

function NavRow({
  item,
  active,
  collapsed,
  animatePill,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  animatePill: boolean;
  onNavigate?: () => void;
}) {
  const reduced = useReducedMotion();
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
        "focus-visible:ring-ring/60 outline-none focus-visible:ring-2",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {active &&
        (animatePill ? (
          <motion.span
            layoutId="sidebar-active"
            className="bg-secondary absolute inset-0 -z-10 rounded-md"
            transition={reduced ? { duration: 0 } : SPRING.snappy}
          />
        ) : (
          <span className="bg-secondary absolute inset-0 -z-10 rounded-md" />
        ))}
      <Icon className="size-[18px] shrink-0" strokeWidth={active ? 2.2 : 2} />
      <span className={cn("truncate transition-opacity duration-150", collapsed && "opacity-0")}>
        {item.label}
      </span>
    </Link>
  );
}
