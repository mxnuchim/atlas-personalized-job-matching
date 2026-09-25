import "server-only";

import { buildMimeMessage, encodeForGmail, type OutgoingMessage } from "@/lib/sending/message";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";

import { gmailClient, gmailConfig } from "./config";
import { classifyGmailError, GmailError } from "./errors";

const logger = log("gmail");

export type SendResult = {
  messageId: string;
  threadId: string;
  /** True when GMAIL_DRY_RUN is on: the message was built but never handed to Gmail. */
  dryRun: boolean;
};

/**
 * Deliver one message. The only function in Atlas that actually sends an email.
 *
 * It does not decide *whether* to send — `evaluateSend` does, and the caller must have
 * cleared it. Keeping the decision and the delivery apart is what makes the §11
 * guardrails testable without a mail server.
 */
export async function sendEmail(message: OutgoingMessage): Promise<SendResult> {
  const config = gmailConfig();
  if (!config.configured) {
    throw new GmailError(
      "config",
      `Gmail is not connected. Missing: ${config.missing.join(", ")}.`,
    );
  }

  const mime = buildMimeMessage(message);

  if (env.GMAIL_DRY_RUN) {
    // A real path to verify the whole chain — guardrails, headers, encoding — without
    // putting a message in a stranger's inbox.
    logger.warn(
      { to: message.to, subject: message.subject, bytes: mime.length },
      "dry run — message built but not sent",
    );
    return { messageId: "dry-run", threadId: "dry-run", dryRun: true };
  }

  try {
    const response = await gmailClient().users.messages.send({
      userId: "me",
      requestBody: { raw: encodeForGmail(mime) },
    });

    const { id, threadId } = response.data;
    if (!id || !threadId) {
      // Gmail accepted it but told us nothing we can track it by, which breaks reply
      // detection. Surface it rather than recording a send we cannot follow up.
      throw new GmailError("upstream", "Gmail accepted the message but returned no id.");
    }

    logger.info({ messageId: id, threadId, to: message.to }, "email sent");
    return { messageId: id, threadId, dryRun: false };
  } catch (error) {
    if (error instanceof GmailError) throw error;
    throw classifyGmailError(error);
  }
}
