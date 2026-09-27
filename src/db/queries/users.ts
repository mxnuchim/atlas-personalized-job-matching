import { asc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { users, type User } from "@/db/schema";

export async function getUserByEmail(email: string): Promise<User | null> {
  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  return user ?? null;
}

export async function getUserById(id: string): Promise<User | null> {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user ?? null;
}

/**
 * The accounts offered on the sign-in picker.
 *
 * This does disclose who has an account to anyone who loads the page — that is what a
 * picker is. It is the right trade for a two-person tool where recognising your own
 * face is the point, and it discloses no more than an email-enumerable login already
 * would. A password is still required; the avatar only saves you typing an address.
 */
export async function listUsersForPicker(): Promise<
  { id: string; email: string; name: string | null; image: string | null }[]
> {
  return db
    .select({ id: users.id, email: users.email, name: users.name, image: users.image })
    .from(users)
    .orderBy(asc(users.createdAt));
}

export async function countUsers(): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  return row?.count ?? 0;
}

export async function createUser(params: {
  email: string;
  passwordHash: string;
  name: string;
}): Promise<User> {
  const [row] = await db
    .insert(users)
    .values({ email: params.email, passwordHash: params.passwordHash, name: params.name })
    .returning();
  return row;
}
