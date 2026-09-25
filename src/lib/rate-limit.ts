import "server-only";

import { and, eq, gt, lt, sql } from "drizzle-orm";

import { db } from "@/db";
import { loginAttempts } from "@/db/schema";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";

/**
 * Login throttling (see `src/db/schema/login-attempts.ts` for why this lives in
 * Postgres rather than memory).
 *
 * Two keys are counted independently, because throttling on one alone is a trap:
 * by email only, anyone who knows the address can lock the real user out; by IP only,
 * a distributed attempt walks straight past it. A request is refused if *either* is
 * over its limit, and a success clears both.
 */

const logger = log("auth");

function windowStart(): Date {
  return new Date(Date.now() - env.LOGIN_WINDOW_MINUTES * 60_000);
}

export function throttleKeys(email: string, ip: string | null): string[] {
  const keys = [`email:${email.trim().toLowerCase()}`];
  if (ip) keys.push(`ip:${ip}`);
  return keys;
}

/**
 * Best-effort IP from the proxy headers. Spoofable by a direct client, which is why
 * the email key exists alongside it — this narrows the cheap attacks, it does not
 * pretend to be identity.
 */
export function clientIp(request: Request | undefined): string | null {
  if (!request) return null;
  const forwarded = request.headers.get("x-forwarded-for");
  // Left-most entry is the original client; the rest are proxies.
  const first = forwarded?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip") || null;
}

/** True when any key has used up its allowance inside the window. */
export async function isThrottled(keys: string[]): Promise<boolean> {
  if (keys.length === 0) return false;

  const rows = await db
    .select({ key: loginAttempts.key, count: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(and(inKeys(keys), gt(loginAttempts.attemptedAt, windowStart())))
    .groupBy(loginAttempts.key);

  const blocked = rows.find((r) => r.count >= env.LOGIN_MAX_ATTEMPTS);
  if (blocked) {
    logger.warn(
      { key: blocked.key, attempts: blocked.count, windowMinutes: env.LOGIN_WINDOW_MINUTES },
      "login throttled",
    );
    return true;
  }
  return false;
}

export async function recordFailure(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await db.insert(loginAttempts).values(keys.map((key) => ({ key })));
  // Opportunistic sweep: rows outside the window can never matter again, and this
  // keeps the table from growing without a scheduled job for it.
  await db.delete(loginAttempts).where(lt(loginAttempts.attemptedAt, windowStart()));
}

export async function clearFailures(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await db.delete(loginAttempts).where(inKeys(keys));
}

function inKeys(keys: string[]) {
  return keys.length === 1 ? eq(loginAttempts.key, keys[0]!) : sql`${loginAttempts.key} in ${keys}`;
}
