import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/db";
import { accountName, publicName } from "./schedule-store";
import { isHatId, type HatId } from "./hat-tricks-hats";
import type { Steal } from "./hat-tricks-score";

const { hatSchedule, hatSteals, user } = schema;

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
      name: publicName,
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

export type StealLogRow = {
  id: string;
  hatId: HatId;
  thief: string;
  stolenAt: Date;
  recordedBy: string | null;
};

/** Every recorded theft, newest first, for the team's tool. */
export async function listStealLog(): Promise<StealLogRow[]> {
  const recorder = alias(user, "recorder");
  const rows = await getDb()
    .select({
      id: hatSteals.id,
      hatId: hatSteals.hatId,
      thief: accountName,
      stolenAt: hatSteals.stolenAt,
      recordedBy: recorder.name,
    })
    .from(hatSteals)
    .innerJoin(user, eq(user.id, hatSteals.userId))
    .leftJoin(recorder, eq(recorder.id, hatSteals.recordedBy))
    .orderBy(desc(hatSteals.stolenAt), desc(hatSteals.createdAt));
  return rows.flatMap((row) =>
    isHatId(row.hatId) ? [{ ...row, hatId: row.hatId }] : [],
  );
}

/** The thief's display name, or null if the account is gone or banned. */
export async function eligibleThiefName(
  userId: string,
): Promise<string | null> {
  const [row] = await getDb()
    .select({ name: accountName })
    .from(user)
    .where(and(eq(user.id, userId), eq(user.banned, false)));
  return row?.name ?? null;
}

export async function recordSteal(steal: Steal, recordedBy: string) {
  await getDb()
    .insert(hatSteals)
    .values({ ...steal, recordedBy });
}

export async function deleteSteal(id: string) {
  await getDb().delete(hatSteals).where(eq(hatSteals.id, id));
}

/** The stored schedule JSON, with version 0 when none has been saved. */
export async function loadSchedule(): Promise<{
  raw: string | undefined;
  version: number;
}> {
  const [row] = await getDb()
    .select({ raw: hatSchedule.shifts, version: hatSchedule.version })
    .from(hatSchedule);
  return row ?? { raw: undefined, version: 0 };
}

/** False, and nothing written, if the schedule has moved past expectedVersion. */
export async function saveSchedule(
  json: string,
  expectedVersion: number,
  updatedBy: string,
): Promise<boolean> {
  const saved = await getDb()
    .insert(hatSchedule)
    .values({ shifts: json, updatedBy })
    .onConflictDoUpdate({
      target: hatSchedule.id,
      set: {
        shifts: json,
        updatedBy,
        updatedAt: new Date(),
        version: expectedVersion + 1,
      },
      setWhere: eq(hatSchedule.version, expectedVersion),
    })
    .returning({ id: hatSchedule.id });
  return saved.length > 0;
}
