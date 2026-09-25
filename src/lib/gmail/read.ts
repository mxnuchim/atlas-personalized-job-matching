import "server-only";

import type { ThreadMessage } from "@/lib/sending/classify";

import { gmailClient, gmailConfig } from "./config";
import { classifyGmailError, GmailError } from "./errors";

/**
 * Reading a thread back, for reply and bounce detection (PRD §11: respect replies;
 * monitor bounces). Returns the thread flattened into the shape `classifyThread` takes,
 * so the decision stays pure and this stays a thin adapter.
 */

function header(
  headers: { name?: string | null; value?: string | null }[] | undefined,
  name: string,
): string {
  const match = headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return match?.value ?? "";
}

/**
 * `metadata` format with an explicit header list: we need From, Subject and Date and
 * nothing else, and not pulling message bodies keeps this well inside Gmail's quota
 * even when every tracked thread is polled.
 */
export async function fetchThreadMessages(threadId: string): Promise<ThreadMessage[]> {
  const config = gmailConfig();
  if (!config.configured) {
    throw new GmailError(
      "config",
      `Gmail is not connected. Missing: ${config.missing.join(", ")}.`,
    );
  }

  try {
    const response = await gmailClient().users.threads.get({
      userId: "me",
      id: threadId,
      format: "metadata",
      metadataHeaders: ["From", "Subject", "Date"],
    });

    return (response.data.messages ?? []).map((message) => ({
      id: message.id ?? "",
      from: header(message.payload?.headers, "From"),
      subject: header(message.payload?.headers, "Subject"),
      // internalDate is Gmail's own receipt time in epoch ms — more reliable than the
      // Date header, which the sender controls and can be wrong or absent.
      receivedAt: Number(message.internalDate ?? 0),
      snippet: message.snippet ?? "",
    }));
  } catch (error) {
    if (error instanceof GmailError) throw error;
    const classified = classifyGmailError(error);
    // A thread that no longer exists is not a failure worth retrying; treat it as empty.
    if (classified.status === 404) return [];
    throw classified;
  }
}
