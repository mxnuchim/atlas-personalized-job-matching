import { eq } from "drizzle-orm";

import { db } from "@/db";
import { sources, type Source } from "@/db/schema";

export async function getEnabledSources(): Promise<Source[]> {
  return db.select().from(sources).where(eq(sources.enabled, true));
}
