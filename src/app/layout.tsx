import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import type { ReactNode } from "react";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

/**
 * One family for the whole app.
 *
 * Manrope carries both jobs — its heavier weights have enough character to hold a
 * display line, so a second family earned nothing. Google Sans, which was the other
 * candidate, is proprietary and not distributed through Google Fonts, so it cannot be
 * served by `next/font/google`.
 *
 * Self-hosted and subsetted by `next/font`, so there is no render-blocking request to
 * fonts.googleapis.com and no layout shift when it lands.
 */
const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: {
    default: "Atlas",
    template: "%s · Atlas",
  },
  description:
    "A personal job-match command center — the roles worth your energy, scored against your real strengths.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${manrope.variable} h-full`}>
      <body className="min-h-full">
        <ThemeProvider>
          {children}
          <Toaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
