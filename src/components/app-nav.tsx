"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";

import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/today", label: "Today" },
  { href: "/jobs", label: "Jobs" },
  { href: "/matches", label: "Matches" },
  { href: "/review", label: "Review" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/sources", label: "Sources" },
  { href: "/runs", label: "Runs" },
  { href: "/settings", label: "Settings" },
] as const;

export function AppNav({ className }: { className?: string }) {
  const pathname = usePathname();
  const reduced = useReducedMotion();

  return (
    <nav className={cn("flex items-center gap-1 overflow-x-auto", className)} aria-label="Primary">
      {NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
              "focus-visible:ring-ring/50 outline-none focus-visible:ring-3",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              // Shared-element pill that slides between tabs as the route changes (§5).
              <motion.span
                layoutId="nav-active"
                className="bg-secondary absolute inset-0 -z-10 rounded-md"
                transition={reduced ? { duration: 0 } : SPRING.snappy}
              />
            )}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
