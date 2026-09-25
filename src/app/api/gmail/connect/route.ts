import { NextResponse } from "next/server";

import { GMAIL_SCOPES, oauthClient, oauthClientReady } from "@/lib/gmail";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start the one-time Gmail consent flow (PRD §6: route handlers for OAuth callbacks).
 *
 * This is a separate grant from the app's own login: Atlas signs you in with
 * credentials, and this authorises a *sending identity*, which §11 requires to be a
 * different address from your primary one.
 */
export async function GET() {
  // Session-checked: this initiates an OAuth grant against your Google account.
  await requireSession();

  // The layer owns knowledge of its own configuration; this route never reads a secret.
  const ready = oauthClientReady();
  if (!ready.ready) {
    return NextResponse.json(
      {
        ok: false,
        error:
          `Set ${ready.missing.join(" and ")} first. Create an OAuth client ` +
          "(type: Web application) in Google Cloud Console and add this app's " +
          "/api/gmail/callback as an authorised redirect URI.",
      },
      { status: 400 },
    );
  }

  const url = oauthClient({ withRefreshToken: false }).generateAuthUrl({
    // `offline` is what mints a refresh token at all; `consent` forces one to be
    // re-issued even if this account has granted before, since Google only returns a
    // refresh token on first consent and we have nowhere to recover a lost one from.
    access_type: "offline",
    prompt: "consent",
    scope: GMAIL_SCOPES,
  });

  return NextResponse.redirect(url);
}
