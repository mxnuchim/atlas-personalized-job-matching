import { CheckIcon, ExternalLinkIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Connecting a sending identity, as steps you can follow rather than a variable name
 * to go and look up. The setup is genuinely fiddly — a Google Cloud OAuth client, a
 * consent flow, a token pasted back into a file — and telling someone to "set
 * GOOGLE_CLIENT_ID" is not instructions, it is a label.
 */
export function GmailSetup({
  missing,
  appUrl,
}: {
  /** Env var names still unset, from `gmailConfig()`. */
  missing: string[];
  appUrl: string;
}) {
  const needsOauthClient =
    missing.includes("GOOGLE_CLIENT_ID") || missing.includes("GOOGLE_CLIENT_SECRET");
  const needsToken = missing.includes("GMAIL_OAUTH_REFRESH_TOKEN");
  const needsAddress = missing.includes("SENDING_ADDRESS");
  const callbackUrl = new URL("/api/gmail/callback", appUrl).toString();

  return (
    <section className="space-y-4 rounded-xl border p-5">
      <div>
        <h2 className="font-display text-base font-semibold">Connect a sending identity</h2>
        <p className="text-muted-foreground mt-1 text-sm text-pretty">
          Atlas needs permission to send as you, and to read replies so it stops chasing anyone who
          answers. Three steps, once.
        </p>
      </div>

      <ol className="space-y-4">
        <Step done={!needsOauthClient} n={1} title="Create a Google OAuth client">
          <p>
            In{" "}
            <Link href="https://console.cloud.google.com/apis/credentials">
              Google Cloud Console → Credentials
            </Link>
            , create an OAuth client ID of type <Code>Web application</Code>, and enable the{" "}
            <Link href="https://console.cloud.google.com/apis/library/gmail.googleapis.com">
              Gmail API
            </Link>{" "}
            for the project.
          </p>
          <p className="mt-2">
            Add this as an authorised redirect URI:
            <Code block>{callbackUrl}</Code>
          </p>
          <p className="mt-2">Then put the two values in your .env.local:</p>
          <Code block>{'GOOGLE_CLIENT_ID="…"\nGOOGLE_CLIENT_SECRET="…"'}</Code>
        </Step>

        <Step done={!needsToken} n={2} title="Grant Atlas permission">
          <p>
            With those set, start the consent flow. Google will hand back a refresh token to paste
            into <Code>.env.local</Code>, then restart the dev server.
          </p>
          {needsOauthClient ? (
            <p className="text-muted-foreground mt-2">Finish step 1 first.</p>
          ) : (
            <a
              href="/api/gmail/connect"
              className="bg-primary text-primary-foreground focus-visible:ring-ring mt-2 inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:outline-none"
            >
              Connect Gmail
              <ExternalLinkIcon className="size-3.5" />
            </a>
          )}
        </Step>

        <Step done={!needsAddress} n={3} title="Choose a separate sending address">
          <p>
            Use an address that is <strong>not</strong> the one you job hunt with. Cold outreach
            from your real inbox puts that inbox&rsquo;s reputation behind every send, and that
            damage is slow to undo.
          </p>
          <Code block>{'SENDING_ADDRESS="outreach@yourdomain.com"'}</Code>
        </Step>
      </ol>

      <p className="text-muted-foreground border-t pt-4 text-sm text-pretty">
        Want to test the whole path without emailing anyone? Set{" "}
        <Code>GMAIL_DRY_RUN=&quot;true&quot;</Code> — every guardrail runs and the message is built,
        but nothing is handed to Gmail.
      </p>
    </section>
  );
}

function Step({
  n,
  title,
  done,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums",
          done ? "text-background" : "bg-muted text-muted-foreground",
        )}
        style={done ? { backgroundColor: "var(--tier-strong)" } : undefined}
      >
        {done ? <CheckIcon className="size-3" strokeWidth={3} /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-medium">
          {title}
          {done && <span className="text-muted-foreground font-normal"> · done</span>}
        </h3>
        <div className="text-muted-foreground mt-1 text-sm leading-relaxed text-pretty">
          {children}
        </div>
      </div>
    </li>
  );
}

function Link({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary focus-visible:ring-ring rounded hover:underline focus-visible:ring-2 focus-visible:outline-none"
    >
      {children}
    </a>
  );
}

function Code({ children, block }: { children: React.ReactNode; block?: boolean }) {
  if (block) {
    return (
      <code className="bg-muted mt-1.5 block overflow-x-auto rounded-md px-2.5 py-2 text-xs whitespace-pre">
        {children}
      </code>
    );
  }
  return <code className="bg-muted rounded px-1 py-0.5 text-xs">{children}</code>;
}
