"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Copy to clipboard, with the confirmation in the button itself.
 *
 * No toast: this is the most-used control on the screen and a toast per copy would be
 * noise. The label swap *is* the feedback (§10.4 — motion that confirms an action,
 * nothing decorative).
 */
export function CopyButton({
  value,
  label = "Copy",
  copiedLabel = "Copied",
  className,
  variant = "default",
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
  variant?: "default" | "ghost";
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [failed, setFailed] = useState(false);

  // Clear on unmount so a copy in a card that then slides out cannot set state after.
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setFailed(false);
      setCopied(true);
    } catch {
      // Clipboard access needs a secure context and can be refused. Say so rather than
      // showing a success state for something that did not happen.
      setFailed(true);
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      // Announced for screen readers, which cannot see the label swap.
      aria-live="polite"
      className={cn(
        "focus-visible:ring-ring inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
        variant === "default"
          ? "bg-primary text-primary-foreground hover:opacity-90"
          : "text-muted-foreground hover:text-foreground hover:bg-muted",
        className,
      )}
    >
      {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
      {failed ? "Press ⌘C" : copied ? copiedLabel : label}
    </button>
  );
}
