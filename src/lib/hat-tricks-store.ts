import "server-only";

import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { isHatId } from "./hat-tricks-hats";
import type { Steal } from "./hat-tricks-score";

const { hatSteals, user } = schema;

/**
 * Every recorded theft, oldest first. The order is the tie-break scoring
 * relies on for two steals of one hat at the same instant.
 */
export async function loadSteals(): Promise<{
  steals: Steal[];
  names: Map<string, string>;
}> {
  const rows = await getDb()
    .select({
      hatId: hatSteals.hatId,
      userId: hatSteals.userId,
      stolenAt: hatSteals.stolenAt,
      name: user.name,
    })
    .from(hatSteals)
    .innerJoin(user, eq(user.id, hatSteals.userId))
    .orderBy(
      asc(hatSteals.stolenAt),
      asc(hatSteals.createdAt),
      asc(hatSteals.id),
    );

  const steals: Steal[] = [];
  const names = new Map<string, string>();
  for (const row of rows) {
    // The check constraint makes this a narrowing, not a filter.
    if (!isHatId(row.hatId)) continue;
    steals.push({
      hatId: row.hatId,
      userId: row.userId,
      stolenAt: row.stolenAt,
    });
    names.set(row.userId, row.name);
  }
  return { steals, names };
}
