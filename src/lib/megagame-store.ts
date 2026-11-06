import "server-only";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  sql,
  type SQLWrapper,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/db";
import { isBadgeCode } from "./badge-code";
import {
  MAX_LEVEL,
  NO_LEVELS,
  isMegagameClass,
  type MegagameClass,
  type MegagameLevels,
} from "./megagame-levels";
import type { QuestInput } from "./megagame-quests";
import {
  BUCKET_ORIGIN,
  bucketIntervalSql,
  isCompleteMegagameCode,
  normalizeMegagameCode,
} from "./megagame-rules";
import { withFreshTicketCode } from "./ticket-code";

// The driver is neon-http: one request per statement and no interactive
// transactions, so every multi-statement write here is safe to retry and
// db.batch() is used only where no read sits between the statements.

/**
 * Several accounts' levels at once, by user id (the home page's speakers).
 * Ids with no profile row are left out of the map.
 */
export async function loadMegagameLevelsFor(
  userIds: string[],
): Promise<Map<string, MegagameLevels>> {
  const out = new Map<string, MegagameLevels>();
  if (userIds.length === 0) return out;
  const { profiles } = schema;
  const rows = await getDb()
    .select({
      id: profiles.userId,
      wizard: profiles.wizardLevel,
      pirate: profiles.pirateLevel,
      alien: profiles.alienLevel,
    })
    .from(profiles)
    .where(inArray(profiles.userId, userIds));
  for (const { id, ...levels } of rows) out.set(id, levels);
  return out;
}

export async function loadMegagameLevels(
  userId: string,
): Promise<MegagameLevels> {
  const levels = await loadMegagameLevelsFor([userId]);
  return levels.get(userId) ?? NO_LEVELS;
}

/** Callers check the levels are in range; the columns' checks back that up. */
export async function setMegagameLevels(
  userId: string,
  levels: MegagameLevels,
): Promise<void> {
  const { profiles } = schema;
  const values = {
    wizardLevel: levels.wizard,
    pirateLevel: levels.pirate,
    alienLevel: levels.alien,
  };
  await getDb()
    .insert(profiles)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: profiles.userId, set: values });
}

const LEVEL_KEY = {
  wizard: "wizardLevel",
  pirate: "pirateLevel",
  alien: "alienLevel",
} as const satisfies Record<
  MegagameClass,
  keyof typeof schema.profiles.$inferInsert
>;

// One column only, so a concurrent change to another class is not overwritten.
// An upsert, since a player may have no profile row yet.
async function setClassLevel(
  userId: string,
  cls: MegagameClass,
  level: number | ReturnType<typeof sql>,
  onConflict: number | ReturnType<typeof sql> = level,
): Promise<number> {
  const { profiles } = schema;
  const column = profiles[LEVEL_KEY[cls]];
  const [row] = await getDb()
    .insert(profiles)
    .values({ userId, [LEVEL_KEY[cls]]: level })
    .onConflictDoUpdate({
      target: profiles.userId,
      set: { [LEVEL_KEY[cls]]: onConflict },
    })
    .returning({ level: column });
  return row?.level ?? 0;
}

// ---- Quests ----

export type Quest = typeof schema.quests.$inferSelect;

/** Takes a code as typed, scanned or pasted; null unless it is a full code. */
export async function findQuestByCode(input: string): Promise<Quest | null> {
  const code = normalizeMegagameCode(input);
  if (!isCompleteMegagameCode(code)) return null;
  const { quests } = schema;
  const [row] = await getDb()
    .select()
    .from(quests)
    .where(eq(quests.code, code))
    .limit(1);
  return row ?? null;
}

/** Every quest, withdrawn ones included, by title. */
export async function listQuests(): Promise<Quest[]> {
  const { quests } = schema;
  return getDb().select().from(quests).orderBy(asc(quests.title));
}

export async function getQuest(id: string): Promise<Quest | null> {
  const { quests } = schema;
  const [row] = await getDb()
    .select()
    .from(quests)
    .where(eq(quests.id, id))
    .limit(1);
  return row ?? null;
}

/** The quests behind a list of ids, in that order; unknown ids drop out. */
export async function questsByIds(ids: readonly string[]): Promise<Quest[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const { quests } = schema;
  const rows = await getDb()
    .select()
    .from(quests)
    .where(inArray(quests.id, unique));
  const byId = new Map(rows.map((q) => [q.id, q]));
  return unique.flatMap((id) => byId.get(id) ?? []);
}

const questRow = (input: QuestInput) => ({
  title: input.title,
  bodyText: input.bodyText,
  bodyImages: input.bodyImages,
  class: input.class,
  minLevel: input.minLevel,
  maxLevel: input.maxLevel,
  minPlayers: input.minPlayers,
  stampsWizard: input.stamps.wizard,
  stampsPirate: input.stamps.pirate,
  stampsAlien: input.stamps.alien,
  stampsAny: input.stamps.any,
  evidence: input.evidence,
  evidenceImage: input.evidenceImage,
  hint: input.hint,
  author: input.author,
  active: input.active,
});

/** Inserts a quest under a fresh label code. */
export async function createQuest(input: QuestInput): Promise<Quest> {
  const { quests } = schema;
  return withFreshTicketCode(async (code) => {
    const [row] = await getDb()
      .insert(quests)
      .values({ ...questRow(input), code })
      .returning();
    return row;
  });
}

/** Null when no quest has the id. */
export async function updateQuest(
  id: string,
  input: QuestInput,
): Promise<Quest | null> {
  const { quests } = schema;
  const [row] = await getDb()
    .update(quests)
    .set({ ...questRow(input), updatedAt: new Date() })
    .where(eq(quests.id, id))
    .returning();
  return row ?? null;
}

export type DeleteQuestResult = "deleted" | "missing" | "has-progress";

/**
 * Deletes a quest nobody has progress on. A quest with progress rows is
 * history and can only be withdrawn (active = false).
 */
export async function deleteQuest(id: string): Promise<DeleteQuestResult> {
  const { quests, questProgress } = schema;
  const db = getDb();
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(questProgress)
    .where(eq(questProgress.questId, id));
  if (n > 0) return "has-progress";
  const rows = await db
    .delete(quests)
    .where(eq(quests.id, id))
    .returning({ id: quests.id });
  return rows.length > 0 ? "deleted" : "missing";
}

/** Live (not undone) completions per quest, for the editor's list. */
export async function completionCountsByQuest(): Promise<Map<string, number>> {
  const { questProgress } = schema;
  const rows = await getDb()
    .select({
      questId: questProgress.questId,
      n: sql<number>`count(*)::int`,
    })
    .from(questProgress)
    .where(eq(questProgress.status, "completed"))
    .groupBy(questProgress.questId);
  return new Map(rows.map((r) => [r.questId, r.n]));
}

// ---- Players ----

export type PlayerSummary = {
  id: string;
  name: string;
  pronouns: string | null;
  imageUrl: string | null;
  levels: MegagameLevels;
};

const playerColumns = () => {
  const { user, profiles } = schema;
  return {
    id: user.id,
    name: user.name,
    pronouns: profiles.pronouns,
    imageUrl: profiles.imageUrl,
    wizard: profiles.wizardLevel,
    pirate: profiles.pirateLevel,
    alien: profiles.alienLevel,
  };
};

type PlayerRow = {
  id: string;
  name: string;
  pronouns: string | null;
  imageUrl: string | null;
  wizard: number | null;
  pirate: number | null;
  alien: number | null;
};

const toPlayer = ({ wizard, pirate, alien, ...rest }: PlayerRow) => ({
  ...rest,
  levels: { wizard: wizard ?? 0, pirate: pirate ?? 0, alien: alien ?? 0 },
});

/**
 * The player whose claimed ticket carries the badge number. A number on an
 * unclaimed ticket is nobody's yet.
 */
export async function findPlayerByBadgeNumber(
  n: number,
): Promise<PlayerSummary | null> {
  if (!isBadgeCode(n)) return null;
  const { user, profiles, tickets } = schema;
  const [row] = await getDb()
    .select(playerColumns())
    .from(tickets)
    .innerJoin(user, eq(user.id, tickets.ownerUserId))
    .leftJoin(profiles, eq(profiles.userId, user.id))
    .where(eq(tickets.badgeCode, n))
    .limit(1);
  return row ? toPlayer(row) : null;
}

/** The players behind a list of user ids, in that order; unknown ids drop out. */
export async function playersByIds(
  ids: readonly string[],
): Promise<PlayerSummary[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const { user, profiles } = schema;
  const rows = await getDb()
    .select(playerColumns())
    .from(user)
    .leftJoin(profiles, eq(profiles.userId, user.id))
    .where(inArray(user.id, unique));
  const byId = new Map(rows.map((r) => [r.id, toPlayer(r)]));
  return unique.flatMap((id) => byId.get(id) ?? []);
}

/** Name search for the volunteer tool. Never creates accounts. */
export async function searchPlayers(
  query: string,
  limit = 10,
): Promise<PlayerSummary[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const q = `%${trimmed.replace(/[\\%_]/g, "\\$&")}%`;
  const { user, profiles } = schema;
  const rows = await getDb()
    .select(playerColumns())
    .from(user)
    .leftJoin(profiles, eq(profiles.userId, user.id))
    .where(ilike(user.name, q))
    .orderBy(asc(user.name))
    .limit(limit);
  return rows.map(toPlayer);
}

// ---- Completions ----

/** A quest_progress row id and the player it belongs to. */
export type CompletionRef = { id: string; userId: string };

export type ConfirmCompletionsInput = {
  questId: string;
  userIds: readonly string[];
  confirmedBy: string;
};

export type ConfirmCompletionsResult =
  | { status: "no-players" }
  | {
      status: "ok";
      /** Rows this call completed. */
      recorded: CompletionRef[];
      /** Requested players whose row was already completed. */
      alreadyCompleted: CompletionRef[];
      /** Requested players with neither, such as a deleted account. */
      notRecorded: string[];
    };

/**
 * Records the quest as completed for each player. One statement: a row that
 * is already completed is left alone, so a retry or a second volunteer
 * confirming the same player at once changes nothing, and an undone row is
 * completed again with its undo fields cleared.
 */
export async function confirmCompletions(
  input: ConfirmCompletionsInput,
): Promise<ConfirmCompletionsResult> {
  const requested = [...new Set(input.userIds)].sort();
  if (requested.length === 0) return { status: "no-players" };
  const db = getDb();
  // The join on "user" skips accounts deleted since the form was filled in.
  const { rows } = await db.execute<{ id: string; user_id: string }>(sql`
    insert into quest_progress (user_id, quest_id, status, completed_at, confirmed_by, updated_at)
    select u.id, ${input.questId}, 'completed', now(), ${input.confirmedBy}, now()
    from unnest(${sql.param(requested)}::text[]) as r(id)
    join "user" u on u.id = r.id
    on conflict (user_id, quest_id) do update
      set status = 'completed', completed_at = now(), confirmed_by = excluded.confirmed_by,
        undone_at = null, undone_by = null, undo_reason = null, updated_at = now()
      where quest_progress.status <> 'completed'
    returning id, user_id
  `);
  const recorded = rows
    .map((r) => ({ id: r.id, userId: r.user_id }))
    .sort((a, b) => a.userId.localeCompare(b.userId));
  const written = new Set(recorded.map((r) => r.userId));
  const rest = requested.filter((id) => !written.has(id));
  let alreadyCompleted: CompletionRef[] = [];
  if (rest.length > 0) {
    const { questProgress } = schema;
    alreadyCompleted = await db
      .select({ id: questProgress.id, userId: questProgress.userId })
      .from(questProgress)
      .where(
        and(
          eq(questProgress.questId, input.questId),
          inArray(questProgress.userId, rest),
          eq(questProgress.status, "completed"),
        ),
      );
    alreadyCompleted.sort((a, b) => a.userId.localeCompare(b.userId));
  }
  const elsewhere = new Set(alreadyCompleted.map((r) => r.userId));
  return {
    status: "ok",
    recorded,
    alreadyCompleted,
    notRecorded: rest.filter((id) => !elsewhere.has(id)),
  };
}

export type UndoCompletionsInput = {
  ids: readonly string[];
  by: string;
  reason: string | null;
};

/** Puts completed rows back to attempted. Returns the ids it changed. */
export async function undoCompletions({
  ids,
  by,
  reason,
}: UndoCompletionsInput): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const { questProgress } = schema;
  const now = new Date();
  const rows = await getDb()
    .update(questProgress)
    .set({
      status: "attempted",
      undoneAt: now,
      undoneBy: by,
      undoReason: reason,
      updatedAt: now,
    })
    .where(
      and(
        inArray(questProgress.id, unique),
        eq(questProgress.status, "completed"),
      ),
    )
    .returning({ id: questProgress.id });
  return rows.map((r) => r.id);
}

export type CompletionRow = {
  id: string;
  userId: string;
  questId: string;
  status: string;
  completedAt: Date | null;
  confirmedBy: string | null;
  undoneAt: Date | null;
};

/** Progress rows by id, in the order asked for; unknown ids drop out. */
export async function completionsByIds(
  ids: readonly string[],
): Promise<CompletionRow[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const { questProgress } = schema;
  const rows = await getDb()
    .select({
      id: questProgress.id,
      userId: questProgress.userId,
      questId: questProgress.questId,
      status: questProgress.status,
      completedAt: questProgress.completedAt,
      confirmedBy: questProgress.confirmedBy,
      undoneAt: questProgress.undoneAt,
    })
    .from(questProgress)
    .where(inArray(questProgress.id, unique));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return unique.flatMap((id) => byId.get(id) ?? []);
}

export type LiveCompletion = {
  id: string;
  userId: string;
  confirmedAt: Date;
  confirmedByName: string | null;
};

/** Completions of a quest among these players: the "already completed" status. */
export async function liveCompletions(
  questId: string,
  userIds: readonly string[],
): Promise<LiveCompletion[]> {
  if (userIds.length === 0) return [];
  const { questProgress, user } = schema;
  const rows = await getDb()
    .select({
      id: questProgress.id,
      userId: questProgress.userId,
      confirmedAt: questProgress.completedAt,
      confirmedByName: user.name,
    })
    .from(questProgress)
    .leftJoin(user, eq(user.id, questProgress.confirmedBy))
    .where(
      and(
        eq(questProgress.questId, questId),
        inArray(questProgress.userId, [...userIds]),
        eq(questProgress.status, "completed"),
      ),
    );
  return rows.filter((r): r is LiveCompletion => r.confirmedAt !== null);
}

/** Completed quests in this class, for the level-up soft checks. */
export async function completionsInClass(
  userId: string,
  cls: MegagameClass,
): Promise<number> {
  const { questProgress, quests } = schema;
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(questProgress)
    .innerJoin(quests, eq(quests.id, questProgress.questId))
    .where(
      and(
        eq(questProgress.userId, userId),
        eq(quests.class, cls),
        eq(questProgress.status, "completed"),
      ),
    );
  return row?.n ?? 0;
}

export type QuestAttemptInput = {
  questId: string;
  /** The players on the board when the answer was checked. */
  userIds: readonly string[];
  correct: boolean;
  enteredBy: string;
};

/**
 * Counts an answer-checker attempt on each player's progress row. A player
 * who already completed the quest keeps that status.
 */
export async function recordQuestAttempt(
  input: QuestAttemptInput,
): Promise<void> {
  const userIds = [...new Set(input.userIds)];
  if (userIds.length === 0) return;
  const { questProgress } = schema;
  const now = new Date();
  await getDb()
    .insert(questProgress)
    .values(
      userIds.map((userId) => ({
        userId,
        questId: input.questId,
        status: "attempted",
        attemptCount: 1,
        firstAttemptAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [questProgress.userId, questProgress.questId],
      set: {
        attemptCount: sql`${questProgress.attemptCount} + 1`,
        firstAttemptAt: sql`coalesce(${questProgress.firstAttemptAt}, now())`,
        updatedAt: now,
      },
    });
}

export type RecentCompletion = {
  id: string;
  questId: string;
  questTitle: string;
  questCode: string;
  userId: string;
  playerName: string | null;
  confirmedBy: string | null;
  confirmedByName: string | null;
  completedAt: Date;
  undoneAt: Date | null;
  undoneByName: string | null;
  undoReason: string | null;
};

/**
 * Completions per player row, newest first, including undone ones, by one
 * volunteer or, with null, by everyone.
 */
export async function recentCompletions(
  confirmedBy: string | null,
  limit = 10,
): Promise<RecentCompletion[]> {
  const { questProgress, quests } = schema;
  const player = alias(schema.user, "player");
  const confirmer = alias(schema.user, "confirmer");
  const undoer = alias(schema.user, "undoer");
  const rows = await getDb()
    .select({
      id: questProgress.id,
      questId: questProgress.questId,
      questTitle: quests.title,
      questCode: quests.code,
      userId: questProgress.userId,
      playerName: player.name,
      confirmedBy: questProgress.confirmedBy,
      confirmedByName: confirmer.name,
      completedAt: questProgress.completedAt,
      undoneAt: questProgress.undoneAt,
      undoneByName: undoer.name,
      undoReason: questProgress.undoReason,
    })
    .from(questProgress)
    .innerJoin(quests, eq(quests.id, questProgress.questId))
    .leftJoin(player, eq(player.id, questProgress.userId))
    .leftJoin(confirmer, eq(confirmer.id, questProgress.confirmedBy))
    .leftJoin(undoer, eq(undoer.id, questProgress.undoneBy))
    .where(
      confirmedBy === null
        ? isNotNull(questProgress.completedAt)
        : and(
            isNotNull(questProgress.completedAt),
            eq(questProgress.confirmedBy, confirmedBy),
          ),
    )
    .orderBy(desc(questProgress.completedAt))
    .limit(limit);
  return rows.filter((r): r is RecentCompletion => r.completedAt !== null);
}

export type RecentLevelUp = {
  id: string;
  playerName: string | null;
  class: string;
  level: number;
  awardedBy: string | null;
  awardedByName: string | null;
  awardedAt: Date;
  checksPassed: boolean;
  overrideReason: string | null;
  cardPhotoUrl: string | null;
  note: string | null;
  voidedAt: Date | null;
};

/** Volunteer level-ups by everyone, live and voided, newest first. */
export async function recentLevelUps(limit = 30): Promise<RecentLevelUp[]> {
  const { levelEvents } = schema;
  const player = alias(schema.user, "player");
  const awarder = alias(schema.user, "awarder");
  return getDb()
    .select({
      id: levelEvents.id,
      playerName: player.name,
      class: levelEvents.class,
      level: levelEvents.level,
      awardedBy: levelEvents.awardedBy,
      awardedByName: awarder.name,
      awardedAt: levelEvents.awardedAt,
      checksPassed: levelEvents.checksPassed,
      overrideReason: levelEvents.overrideReason,
      cardPhotoUrl: levelEvents.cardPhotoUrl,
      note: levelEvents.note,
      voidedAt: levelEvents.voidedAt,
    })
    .from(levelEvents)
    .leftJoin(player, eq(player.id, levelEvents.userId))
    .leftJoin(awarder, eq(awarder.id, levelEvents.awardedBy))
    .where(eq(levelEvents.source, "volunteer"))
    .orderBy(desc(levelEvents.awardedAt))
    .limit(limit);
}

// ---- Level events ----

export type LevelEvent = typeof schema.levelEvents.$inferSelect;

export type RecordLevelUpInput = {
  /** Generated by the volunteer's form; reusing it makes a retry a no-op. */
  id: string;
  userId: string;
  class: MegagameClass;
  level: number;
  awardedBy: string;
  checksPassed: boolean;
  overrideReason?: string | null;
  cardPhotoUrl?: string | null;
  note?: string | null;
};

export type LevelUpResult = {
  status:
    | "awarded"
    | "retry"
    | "id-reused"
    | "already-awarded"
    | "voided"
    | "invalid";
};

/**
 * Writes the audit row, then raises the class column. The caller runs
 * checkLevelUp first; that read is not atomic with this write, which is
 * acceptable for soft checks.
 */
export async function recordLevelUp(
  input: RecordLevelUpInput,
): Promise<LevelUpResult> {
  const { id, userId, level } = input;
  const cls = input.class;
  if (
    !isMegagameClass(cls) ||
    !Number.isInteger(level) ||
    level < 1 ||
    level > MAX_LEVEL
  ) {
    return { status: "invalid" };
  }
  const { levelEvents, profiles } = schema;
  const db = getDb();
  // Untargeted, so both an id collision and a live (user, class, level)
  // duplicate are absorbed; the read-back below tells them apart.
  const inserted = await db
    .insert(levelEvents)
    .values({
      id,
      userId,
      class: cls,
      level,
      source: "volunteer",
      awardedBy: input.awardedBy,
      checksPassed: input.checksPassed,
      overrideReason: input.overrideReason ?? null,
      cardPhotoUrl: input.cardPhotoUrl ?? null,
      note: input.note ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: levelEvents.id });

  const raise = () =>
    setClassLevel(
      userId,
      cls,
      level,
      sql`greatest(${profiles[LEVEL_KEY[cls]]}, ${level})`,
    );

  if (inserted.length > 0) {
    await raise();
    return { status: "awarded" };
  }
  const [existing] = await db
    .select({
      id: levelEvents.id,
      userId: levelEvents.userId,
      class: levelEvents.class,
      level: levelEvents.level,
      voidedAt: levelEvents.voidedAt,
    })
    .from(levelEvents)
    .where(eq(levelEvents.id, id))
    .limit(1);
  if (!existing) return { status: "already-awarded" };
  if (
    existing.userId !== userId ||
    existing.class !== cls ||
    existing.level !== level
  ) {
    return { status: "id-reused" };
  }
  if (existing.voidedAt) return { status: "voided" };
  // Repeats the column write, which repairs a crash between the two writes.
  await raise();
  return { status: "retry" };
}

export type VoidInput = { id: string; voidedBy: string; reason: string | null };

export type VoidLevelEventResult =
  | { status: "voided" | "already-voided"; level: number }
  | { status: "not-found" | "not-volunteer" };

/**
 * Undo a volunteer level-up, then recompute that class's column from the
 * player's remaining live events. A picker join counts as a level 1 event;
 * joins from before level_events existed get their rows from
 * scripts/backfill-megagame-picker-joins.mjs.
 */
export async function voidLevelEvent({
  id,
  voidedBy,
  reason,
}: VoidInput): Promise<VoidLevelEventResult> {
  const { levelEvents } = schema;
  const db = getDb();
  const [voided] = await db
    .update(levelEvents)
    .set({ voidedAt: new Date(), voidedBy, voidReason: reason })
    .where(
      and(
        eq(levelEvents.id, id),
        isNull(levelEvents.voidedAt),
        eq(levelEvents.source, "volunteer"),
      ),
    )
    .returning({ userId: levelEvents.userId, class: levelEvents.class });

  let target = voided;
  let status: "voided" | "already-voided" = "voided";
  if (!target) {
    const [row] = await db
      .select({
        userId: levelEvents.userId,
        class: levelEvents.class,
        source: levelEvents.source,
        voidedAt: levelEvents.voidedAt,
      })
      .from(levelEvents)
      .where(eq(levelEvents.id, id))
      .limit(1);
    if (!row) return { status: "not-found" };
    if (row.source !== "volunteer") return { status: "not-volunteer" };
    target = row;
    status = "already-voided";
  }

  const cls = target.class;
  if (!target.userId || !isMegagameClass(cls)) return { status, level: 0 };
  const { profiles } = schema;
  const column = profiles[LEVEL_KEY[cls]];
  const liveMax = sql`coalesce((select max(${levelEvents.level}) from ${levelEvents} where ${levelEvents.userId} = ${target.userId} and ${levelEvents.class} = ${cls} and ${levelEvents.voidedAt} is null), 0)`;
  // The recompute can lower the column. If an award commits while it runs, its
  // stale subquery may overwrite the award's raise, so a second statement with
  // a fresh snapshot raises the column back to the live maximum.
  await setClassLevel(target.userId, cls, liveMax);
  const level = await setClassLevel(
    target.userId,
    cls,
    liveMax,
    sql`greatest(${column}, ${liveMax})`,
  );
  return { status, level };
}

/**
 * The /account picker's audit row: level 1 in the chosen class. Earlier picker
 * joins in other classes are voided in the same batch, since the picker resets
 * those columns to 0 and a later undo must not bring them back.
 */
export async function recordPickerJoin(
  userId: string,
  cls: MegagameClass,
): Promise<void> {
  const { levelEvents } = schema;
  const db = getDb();
  await db.batch([
    db
      .update(levelEvents)
      .set({
        voidedAt: new Date(),
        voidedBy: userId,
        voidReason: "Switched class on /account",
      })
      .where(
        and(
          eq(levelEvents.userId, userId),
          eq(levelEvents.source, "picker"),
          ne(levelEvents.class, cls),
          isNull(levelEvents.voidedAt),
        ),
      ),
    db
      .insert(levelEvents)
      .values({
        id: crypto.randomUUID(),
        userId,
        class: cls,
        level: 1,
        source: "picker",
        awardedBy: userId,
        checksPassed: true,
      })
      .onConflictDoNothing(),
  ]);
}

/** Whether a volunteer has recorded a live level-up for this player. */
export async function hasVolunteerLevelEvent(userId: string): Promise<boolean> {
  const { levelEvents } = schema;
  const [row] = await getDb()
    .select({ id: levelEvents.id })
    .from(levelEvents)
    .where(
      and(
        eq(levelEvents.userId, userId),
        eq(levelEvents.source, "volunteer"),
        isNull(levelEvents.voidedAt),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export async function findLevelEvent(id: string): Promise<LevelEvent | null> {
  const { levelEvents } = schema;
  const [row] = await getDb()
    .select()
    .from(levelEvents)
    .where(eq(levelEvents.id, id))
    .limit(1);
  return row ?? null;
}

// ---- Over time ----

// The interval comes only from bucketIntervalSql's whitelist, and goes in as a
// bound parameter rather than SQL text.
const dateBin = (size: string, column: SQLWrapper) =>
  sql`date_bin(${bucketIntervalSql(size)}::interval, ${column}, ${BUCKET_ORIGIN.toISOString()}::timestamptz)`;

export type CompletionBucket = {
  bucket: Date;
  class: string | null;
  n: number;
};

/** Completions per bucket and quest class, for [from, to). */
export async function completionSeries(
  size: string,
  from: Date,
  to: Date,
): Promise<CompletionBucket[]> {
  const { questProgress, quests } = schema;
  const bucket = dateBin(size, questProgress.completedAt);
  const rows = await getDb()
    .select({
      bucket: bucket.mapWith(String),
      class: quests.class,
      n: sql<number>`count(*)::int`,
    })
    .from(questProgress)
    .innerJoin(quests, eq(quests.id, questProgress.questId))
    .where(
      and(
        eq(questProgress.status, "completed"),
        gte(questProgress.completedAt, from),
        lt(questProgress.completedAt, to),
      ),
    )
    .groupBy(sql`1`, sql`2`)
    .orderBy(sql`1`);
  return rows.map((r) => ({ ...r, bucket: new Date(r.bucket) }));
}

export type LevelEventBucket = {
  bucket: Date;
  class: string;
  source: string;
  n: number;
};

/** Live level events per bucket, class and source, for [from, to). */
export async function levelEventSeries(
  size: string,
  from: Date,
  to: Date,
): Promise<LevelEventBucket[]> {
  const { levelEvents } = schema;
  const bucket = dateBin(size, levelEvents.awardedAt);
  const rows = await getDb()
    .select({
      bucket: bucket.mapWith(String),
      class: levelEvents.class,
      source: levelEvents.source,
      n: sql<number>`count(*)::int`,
    })
    .from(levelEvents)
    .where(
      and(
        isNull(levelEvents.voidedAt),
        gte(levelEvents.awardedAt, from),
        lt(levelEvents.awardedAt, to),
      ),
    )
    .groupBy(sql`1`, sql`2`, sql`3`)
    .orderBy(sql`1`);
  return rows.map((r) => ({ ...r, bucket: new Date(r.bucket) }));
}

export type VoidRow = {
  id: string;
  voidedAt: Date;
  voidedByName: string | null;
  reason: string | null;
  playerName: string | null;
  class: string;
  level: number;
};

/**
 * Volunteer level-ups undone, newest first. Picker rows voided by a class
 * switch are left out. Undone completions show on their own rows instead.
 */
export async function recentVoids(limit = 20): Promise<VoidRow[]> {
  const { levelEvents } = schema;
  const voider = alias(schema.user, "voider");
  const player = alias(schema.user, "player");
  const rows = await getDb()
    .select({
      id: levelEvents.id,
      voidedAt: levelEvents.voidedAt,
      voidedByName: voider.name,
      reason: levelEvents.voidReason,
      playerName: player.name,
      class: levelEvents.class,
      level: levelEvents.level,
    })
    .from(levelEvents)
    .leftJoin(voider, eq(voider.id, levelEvents.voidedBy))
    .leftJoin(player, eq(player.id, levelEvents.userId))
    .where(
      and(isNotNull(levelEvents.voidedAt), eq(levelEvents.source, "volunteer")),
    )
    .orderBy(desc(levelEvents.voidedAt))
    .limit(limit);
  return rows.filter((r): r is VoidRow => r.voidedAt !== null);
}
