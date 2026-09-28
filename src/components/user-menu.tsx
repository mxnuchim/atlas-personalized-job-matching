"use client";

import { ChevronsUpDownIcon, LogOutIcon } from "lucide-react";

import { signOutAction } from "@/app/(app)/actions";
import { Avatar } from "@/components/avatar";
import { avatarFor } from "@/lib/avatars";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** The account control in the sidebar footer: avatar + identity, opening the menu upward. */
export function UserMenu({
  name,
  email,
  collapsed = false,
}: {
  name?: string | null;
  email?: string | null;
  collapsed?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account"
          className={cn(
            "hover:bg-secondary focus-visible:ring-ring flex items-center gap-2 rounded-md p-1.5 transition-colors focus-visible:ring-2 focus-visible:outline-none",
            collapsed ? "justify-center" : "min-w-0 flex-1",
          )}
        >
          <Avatar name={name ?? null} email={email ?? ""} image={avatarFor(email)} size={28} />
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sm font-medium">{name ?? "Account"}</span>
                {email ? (
                  <span className="text-muted-foreground block truncate text-xs">{email}</span>
                ) : null}
              </span>
              <ChevronsUpDownIcon className="text-muted-foreground size-4 shrink-0" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <span className="block text-sm font-medium">{name ?? "Signed in"}</span>
          {email ? (
            <span className="text-muted-foreground block truncate text-xs">{email}</span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <form action={signOutAction}>
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full cursor-pointer">
              <LogOutIcon />
              Sign out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
