import "server-only";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
  type SQLWrapper,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/db";
import {
  MAX_LEVEL,
  MEGAGAME_CLASSES,
  NO_LEVELS,
  isMegagameClass,
  type MegagameClass,
  type MegagameLevels,
} from "./megagame-levels";
import type { QuestImportRow } from "./megagame-quest-csv";
import {
  BUCKET_ORIGIN,
  bucketIntervalSql,
  isCompleteMegagameCode,
  normalizeMegagameCode,
  type DatedLevelEvent,
  type EventTable,
} from "./megagame-rules";
import { visibleTickets } from "./ticket-store";
import { randomTicketCode, withFreshTicketCode } from "./ticket-code";

// The driver is neon-http: one request per statement and no interactive
// transactions, so every multi-statement write here is safe to retry and
// db.batch() is used only where no read sits between the statements.

export async function loadMegagameLevels(
  userId: string,
): Promise<MegagameLevels> {
  const { user } = schema;
  const [row] = await getDb()
    .select({
      wizard: user.wizardLevel,
      pirate: user.pirateLevel,
      alien: user.alienLevel,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return row ?? NO_LEVELS;
}

/** Callers check the levels are in range; the columns' checks back that up. */
export async function setMegagameLevels(
  userId: string,
  levels: MegagameLevels,
): Promise<void> {
  const { user } = schema;
  await getDb()
    .update(user)
    .set({
      wizardLevel: levels.wizard,
      pirateLevel: levels.pirate,
      alienLevel: levels.alien,
    })
    .where(eq(user.id, userId));
}

const LEVEL_KEY = {
  wizard: "wizardLevel",
  pirate: "pirateLevel",
  alien: "alienLevel",
} as const satisfies Record<
  MegagameClass,
  keyof typeof schema.user.$inferInsert
>;

// One column only, so a concurrent change to another class is not overwritten.
async function setClassLevel(
  userId: string,
  cls: MegagameClass,
  level: number | ReturnType<typeof sql>,
): Promise<void> {
  const { user } = schema;
  await getDb()
    .update(user)
    .set({ [LEVEL_KEY[cls]]: level })
    .where(eq(user.id, userId));
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

export async function listQuests(): Promise<Quest[]> {
  const { quests } = schema;
  return getDb()
    .select()
    .from(quests)
    .orderBy(asc(quests.createdAt), asc(quests.code));
}

const FRESH_CODE_ATTEMPTS = 5;

/** A blank active is dropped so the insert takes the column default. */
const questValues = ({ active, ...rest }: QuestImportRow) =>
  active === null ? rest : { ...rest, active };

/**
 * Rows with a code replace that quest's fields (active only when the row
 * gives it); rows without one become new quests under fresh codes.
 */
export async function importQuests(
  rows: readonly QuestImportRow[],
): Promise<{ created: number; updated: number }> {
  const { quests } = schema;
  const db = getDb();
  const coded = rows.filter((r) => r.code !== null);
  let updated = 0;
  if (coded.length > 0) {
    const existing = await db
      .select({ code: quests.code })
      .from(quests)
      .where(
        inArray(
          quests.code,
          coded.map((r) => r.code as string),
        ),
      );
    updated = existing.length;
    // A blank active leaves the stored value alone, so those rows go in a
    // separate upsert whose update does not touch the column.
    const upsert = (batch: QuestImportRow[], withActive: boolean) =>
      db
        .insert(quests)
        .values(
          batch.map((r) => ({ ...questValues(r), code: r.code as string })),
        )
        .onConflictDoUpdate({
          target: quests.code,
          set: {
            title: sql`excluded.title`,
            class: sql`excluded.class`,
            kind: sql`excluded.kind`,
            answers: sql`excluded.answers`,
            evidence: sql`excluded.evidence`,
            hint: sql`excluded.hint`,
            minLevel: sql`excluded.min_level`,
            maxLevel: sql`excluded.max_level`,
            ...(withActive ? { active: sql`excluded.active` } : {}),
            updatedAt: sql`now()`,
          },
        });
    const withActive = coded.filter((r) => r.active !== null);
    const withoutActive = coded.filter((r) => r.active === null);
    if (withActive.length > 0) await upsert(withActive, true);
    if (withoutActive.length > 0) await upsert(withoutActive, false);
  }

  // One insert for all of them; a code that turns out to be taken is the
  // do-nothing case, and only those rows go round again.
  let pending = rows.filter((r) => r.code === null);
  for (
    let attempt = 0;
    pending.length > 0 && attempt < FRESH_CODE_ATTEMPTS;
    attempt++
  ) {
    const taken = new Set(coded.map((r) => r.code));
    const values = pending.map((r) => {
      let code: string;
      do code = randomTicketCode();
      while (taken.has(code));
      taken.add(code);
      return { ...questValues(r), code };
    });
    const inserted = await db
      .insert(quests)
      .values(values)
      .onConflictDoNothing({ target: quests.code })
      .returning({ code: quests.code });
    const done = new Set(inserted.map((r) => r.code));
    pending = pending.filter((_, i) => !done.has(values[i].code));
  }
  if (pending.length > 0)
    throw new Error(`No free quest code for ${pending.length} rows`);
  return { created: rows.length - updated, updated };
}

// ---- Players ----

export type PlayerSummary = {
  id: string;
  name: string;
  pronouns: string | null;
  imageUrl: string | null;
  levels: MegagameLevels;
  code: string | null;
};

const playerColumns = () => {
  const { user, profiles, playerCodes } = schema;
  return {
    id: user.id,
    name: user.name,
    pronouns: profiles.pronouns,
    imageUrl: profiles.imageUrl,
    wizard: user.wizardLevel,
    pirate: user.pirateLevel,
    alien: user.alienLevel,
    code: playerCodes.code,
  };
};

type PlayerRow = {
  id: string;
  name: string;
  pronouns: string | null;
  imageUrl: string | null;
  wizard: number;
  pirate: number;
  alien: number;
  code: string | null;
};

const toPlayer = ({ wizard, pirate, alien, ...rest }: PlayerRow) => ({
  ...rest,
  levels: { wizard, pirate, alien },
});

export async function findPlayerByCode(
  input: string,
): Promise<PlayerSummary | null> {
  const code = normalizeMegagameCode(input);
  if (!isCompleteMegagameCode(code)) return null;
  const { user, profiles, playerCodes } = schema;
  const [row] = await getDb()
    .select(playerColumns())
    .from(playerCodes)
    .innerJoin(user, eq(user.id, playerCodes.userId))
    .leftJoin(profiles, eq(profiles.userId, user.id))
    .where(eq(playerCodes.code, code))
    .limit(1);
  return row ? toPlayer(row) : null;
}

/** The players behind a list of user ids, in that order; unknown ids drop out. */
export async function playersByIds(
  ids: readonly string[],
): Promise<PlayerSummary[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const { user, profiles, playerCodes } = schema;
  const rows = await getDb()
    .select(playerColumns())
    .from(user)
    .leftJoin(profiles, eq(profiles.userId, user.id))
    .leftJoin(playerCodes, eq(playerCodes.userId, user.id))
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
  const { user, profiles, playerCodes } = schema;
  const rows = await getDb()
    .select(playerColumns())
    .from(user)
    .leftJoin(profiles, eq(profiles.userId, user.id))
    .leftJoin(playerCodes, eq(playerCodes.userId, user.id))
    .where(ilike(user.name, q))
    .orderBy(asc(user.name))
    .limit(limit);
  return rows.map(toPlayer);
}

/** The player's badge code, made now if they have none. */
export async function ensurePlayerCode(userId: string): Promise<string> {
  const { playerCodes } = schema;
  const db = getDb();
  const read = async () => {
    const [row] = await db
      .select({ code: playerCodes.code })
      .from(playerCodes)
      .where(eq(playerCodes.userId, userId))
      .limit(1);
    return row?.code ?? null;
  };
  const existing = await read();
  if (existing) return existing;
  // A taken code is a unique violation, which withFreshTicketCode retries; a
  // concurrent request for the same player is the do-nothing case.
  const [created] = await withFreshTicketCode((code) =>
    db
      .insert(playerCodes)
      .values({ userId, code })
      .onConflictDoNothing({ target: playerCodes.userId })
      .returning({ code: playerCodes.code }),
  );
  if (created) return created.code;
  const raced = await read();
  if (!raced) throw new Error(`No player code for ${userId}`);
  return raced;
}

// ---- Confirmations ----

export type Confirmation = typeof schema.confirmations.$inferSelect;

export type ConfirmationOutcome =
  | { status: "voided"; confirmation: Confirmation }
  | {
      status: "ok";
      confirmation: Confirmation;
      /** Completions this confirmation recorded. */
      recorded: string[];
      /** Requested players with a live completion from another confirmation. */
      alreadyCompleted: string[];
      /** Requested players with neither, such as a deleted account. */
      notRecorded: string[];
    };

export type ConfirmResult =
  | { status: "voided" }
  | { status: "quest-mismatch" }
  | { status: "players-mismatch" }
  | { status: "no-players" }
  | Extract<ConfirmationOutcome, { status: "ok" }>;

export type ConfirmInput = {
  /** Generated by the volunteer's form; reusing it makes a retry a no-op. */
  id: string;
  questId: string;
  requestedUserIds: readonly string[];
  confirmedBy: string;
};

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().every((id, i) => id === b[i]);

export async function confirmQuest(
  input: ConfirmInput,
): Promise<ConfirmResult> {
  const requested = [...new Set(input.requestedUserIds)].sort();
  if (requested.length === 0) return { status: "no-players" };
  const { confirmations } = schema;
  const db = getDb();

  await db
    .insert(confirmations)
    .values({
      id: input.id,
      questId: input.questId,
      requestedUserIds: requested,
      confirmedBy: input.confirmedBy,
    })
    .onConflictDoNothing({ target: confirmations.id });

  const [row] = await db
    .select()
    .from(confirmations)
    .where(eq(confirmations.id, input.id))
    .limit(1);
  if (!row) throw new Error(`Confirmation ${input.id} vanished`);
  if (row.voidedAt) return { status: "voided" };
  if (row.questId !== input.questId) return { status: "quest-mismatch" };
  if (!sameIds(row.requestedUserIds, requested)) {
    return { status: "players-mismatch" };
  }

  // One statement that reads and share-locks the stored confirmation, so a
  // concurrent undo either waits for this insert and voids its rows, or
  // commits first and this insert finds it voided. Quest and players come from
  // the stored row, the join on "user" skips accounts deleted since the form
  // was filled in, and "not exists" keeps a player voided out of this
  // confirmation from coming back on a retry.
  await db.execute(sql`
    insert into quest_completions (confirmation_id, quest_id, user_id)
    select c.id, c.quest_id, u.id
    from confirmations c
    cross join lateral unnest(c.requested_user_ids) as r(id)
    join "user" u on u.id = r.id
    where c.id = ${row.id} and c.voided_at is null
      and not exists (select 1 from quest_completions q where q.confirmation_id = c.id and q.user_id = u.id)
    for share of c
    on conflict (quest_id, user_id) where voided_at is null and user_id is not null do nothing
  `);

  return outcomeFor(row);
}

async function outcomeFor(
  row: Confirmation,
): Promise<Extract<ConfirmationOutcome, { status: "ok" }>> {
  const { questCompletions } = schema;
  const db = getDb();
  const mine = await db
    .select({ userId: questCompletions.userId })
    .from(questCompletions)
    .where(
      and(
        eq(questCompletions.confirmationId, row.id),
        isNull(questCompletions.voidedAt),
      ),
    );
  const recorded = new Set(
    mine.map((r) => r.userId).filter((id) => id !== null),
  );
  const rest = row.requestedUserIds.filter((id) => !recorded.has(id));
  const elsewhere = new Set<string>();
  if (rest.length > 0) {
    const others = await db
      .select({ userId: questCompletions.userId })
      .from(questCompletions)
      .where(
        and(
          eq(questCompletions.questId, row.questId),
          inArray(questCompletions.userId, rest),
          isNull(questCompletions.voidedAt),
        ),
      );
    for (const r of others) if (r.userId) elsewhere.add(r.userId);
  }
  return {
    status: "ok",
    confirmation: row,
    recorded: row.requestedUserIds.filter((id) => recorded.has(id)),
    alreadyCompleted: rest.filter((id) => elsewhere.has(id)),
    notRecorded: rest.filter((id) => !elsewhere.has(id)),
  };
}

/** What a confirmation recorded, for the result page on reload. */
export async function confirmationOutcome(
  id: string,
): Promise<ConfirmationOutcome | null> {
  const { confirmations } = schema;
  const [row] = await getDb()
    .select()
    .from(confirmations)
    .where(eq(confirmations.id, id))
    .limit(1);
  if (!row) return null;
  if (row.voidedAt) return { status: "voided", confirmation: row };
  return outcomeFor(row);
}

export type VoidInput = { id: string; voidedBy: string; reason: string | null };

/** Undo a whole confirmation. False when it was already voided. */
export async function voidConfirmation({
  id,
  voidedBy,
  reason,
}: VoidInput): Promise<boolean> {
  const { confirmations, questCompletions } = schema;
  const db = getDb();
  const voided = { voidedAt: new Date(), voidedBy, voidReason: reason };
  const [rows] = await db.batch([
    db
      .update(confirmations)
      .set(voided)
      .where(and(eq(confirmations.id, id), isNull(confirmations.voidedAt)))
      .returning({ id: confirmations.id }),
    db
      .update(questCompletions)
      .set(voided)
      .where(
        and(
          eq(questCompletions.confirmationId, id),
          isNull(questCompletions.voidedAt),
        ),
      ),
  ]);
  return rows.length > 0;
}

/** Void one player's completion out of a group. False when already voided. */
export async function voidCompletion({
  id,
  voidedBy,
  reason,
}: VoidInput): Promise<boolean> {
  const { questCompletions } = schema;
  const rows = await getDb()
    .update(questCompletions)
    .set({ voidedAt: new Date(), voidedBy, voidReason: reason })
    .where(and(eq(questCompletions.id, id), isNull(questCompletions.voidedAt)))
    .returning({ id: questCompletions.id });
  return rows.length > 0;
}

export type LiveCompletion = {
  id: string;
  userId: string;
  confirmationId: string;
  confirmedAt: Date;
  confirmedByName: string | null;
};

/** Live completions of a quest among these players: the "already completed" status. */
export async function liveCompletions(
  questId: string,
  userIds: readonly string[],
): Promise<LiveCompletion[]> {
  if (userIds.length === 0) return [];
  const { questCompletions, confirmations, user } = schema;
  const rows = await getDb()
    .select({
      id: questCompletions.id,
      userId: questCompletions.userId,
      confirmationId: questCompletions.confirmationId,
      confirmedAt: questCompletions.confirmedAt,
      confirmedByName: user.name,
    })
    .from(questCompletions)
    .innerJoin(
      confirmations,
      eq(confirmations.id, questCompletions.confirmationId),
    )
    .leftJoin(user, eq(user.id, confirmations.confirmedBy))
    .where(
      and(
        eq(questCompletions.questId, questId),
        inArray(questCompletions.userId, [...userIds]),
        isNull(questCompletions.voidedAt),
      ),
    );
  return rows.filter((r): r is LiveCompletion => r.userId !== null);
}

/** Live completions of quests in this class, for the level-up soft checks. */
export async function completionsInClass(
  userId: string,
  cls: MegagameClass,
): Promise<number> {
  const { questCompletions, quests } = schema;
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(questCompletions)
    .innerJoin(quests, eq(quests.id, questCompletions.questId))
    .where(
      and(
        eq(questCompletions.userId, userId),
        eq(quests.class, cls),
        isNull(questCompletions.voidedAt),
      ),
    );
  return row?.n ?? 0;
}

export type RecentConfirmation = {
  id: string;
  questId: string;
  questTitle: string;
  questCode: string;
  players: number;
  confirmedBy: string | null;
  confirmedByName: string | null;
  createdAt: Date;
  voidedAt: Date | null;
};

/** The latest confirmations, by one volunteer or, with null, by everyone. */
export async function recentConfirmations(
  confirmedBy: string | null,
  limit = 10,
): Promise<RecentConfirmation[]> {
  const { confirmations, quests } = schema;
  const by = alias(schema.user, "confirmer");
  return getDb()
    .select({
      id: confirmations.id,
      questId: confirmations.questId,
      questTitle: quests.title,
      questCode: quests.code,
      // What it recorded, or had recorded before a whole undo.
      players: sql<number>`(select count(*)::int from quest_completions q where q.confirmation_id = ${confirmations.id} and (q.voided_at is null or ${confirmations.voidedAt} is not null))`,
      confirmedBy: confirmations.confirmedBy,
      confirmedByName: by.name,
      createdAt: confirmations.createdAt,
      voidedAt: confirmations.voidedAt,
    })
    .from(confirmations)
    .innerJoin(quests, eq(quests.id, confirmations.questId))
    .leftJoin(by, eq(by.id, confirmations.confirmedBy))
    .where(
      confirmedBy === null
        ? undefined
        : eq(confirmations.confirmedBy, confirmedBy),
    )
    .orderBy(desc(confirmations.createdAt))
    .limit(limit);
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
  const { levelEvents, user } = schema;
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
      sql`greatest(${user[LEVEL_KEY[cls]]}, ${level})`,
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

export type QuestAttemptInput = {
  questId: string;
  enteredBy: string;
  enteredAnswer: string;
  correct: boolean;
};

export async function recordQuestAttempt(
  input: QuestAttemptInput,
): Promise<void> {
  await getDb().insert(schema.questAttempts).values(input);
}

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
  const { user } = schema;
  const column = user[LEVEL_KEY[cls]];
  const liveMax = sql`coalesce((select max(${levelEvents.level}) from ${levelEvents} where ${levelEvents.userId} = ${target.userId} and ${levelEvents.class} = ${cls} and ${levelEvents.voidedAt} is null), 0)`;
  // The recompute can lower the column. If an award commits while it runs, its
  // stale subquery may overwrite the award's raise, so a second statement with
  // a fresh snapshot raises the column back to the live maximum.
  await setClassLevel(target.userId, cls, liveMax);
  const [repaired] = await db
    .update(user)
    .set({ [LEVEL_KEY[cls]]: sql`greatest(${column}, ${liveMax})` })
    .where(eq(user.id, target.userId))
    .returning({ level: column });
  const level = repaired?.level ?? 0;
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

/** A player's level events, newest first, voided ones included. */
export async function levelEventsFor(userId: string): Promise<LevelEvent[]> {
  const { levelEvents } = schema;
  return getDb()
    .select()
    .from(levelEvents)
    .where(eq(levelEvents.userId, userId))
    .orderBy(desc(levelEvents.awardedAt));
}

// ---- Dashboard ----

/** Players per current level in each class, from the user columns; index = level. */
export async function levelGrid(): Promise<Record<MegagameClass, number[]>> {
  const { user } = schema;
  const rows = await getDb()
    .select({
      wizard: user.wizardLevel,
      pirate: user.pirateLevel,
      alien: user.alienLevel,
      n: sql<number>`count(*)::int`,
    })
    .from(user)
    .where(
      or(
        gt(user.wizardLevel, 0),
        gt(user.pirateLevel, 0),
        gt(user.alienLevel, 0),
      ),
    )
    .groupBy(user.wizardLevel, user.pirateLevel, user.alienLevel);
  const grid = Object.fromEntries(
    MEGAGAME_CLASSES.map((c) => [c, new Array(MAX_LEVEL + 1).fill(0)]),
  ) as Record<MegagameClass, number[]>;
  for (const row of rows) {
    for (const c of MEGAGAME_CLASSES) {
      const level = row[c];
      if (level >= 1 && level <= MAX_LEVEL) grid[c][level] += row.n;
    }
  }
  return grid;
}

/** Accounts that have claimed a paid ticket: the dashboard's denominator. */
export async function claimedTicketHolderCount(): Promise<number> {
  const { tickets } = schema;
  const [row] = await getDb()
    .select({ n: sql<number>`count(distinct ${tickets.ownerUserId})::int` })
    .from(tickets)
    .where(
      and(
        visibleTickets,
        isNotNull(tickets.ownerUserId),
        eq(tickets.status, "paid"),
      ),
    );
  return row?.n ?? 0;
}

export type QuestCount = {
  id: string;
  code: string;
  title: string;
  class: string | null;
  active: boolean;
  n: number;
};

/** Live completions per quest, quests with none included, most first. */
export async function questCompletionCounts(): Promise<QuestCount[]> {
  const { quests, questCompletions } = schema;
  const n = sql<number>`count(${questCompletions.id})::int`;
  return getDb()
    .select({
      id: quests.id,
      code: quests.code,
      title: quests.title,
      class: quests.class,
      active: quests.active,
      n,
    })
    .from(quests)
    .leftJoin(
      questCompletions,
      and(
        eq(questCompletions.questId, quests.id),
        isNull(questCompletions.voidedAt),
      ),
    )
    .groupBy(quests.id)
    .orderBy(desc(n), asc(quests.code));
}

/** Players with at least one live completion; deleted accounts count as one. */
export async function distinctCompletingPlayers(): Promise<number> {
  const { questCompletions } = schema;
  const [row] = await getDb()
    .select({
      n: sql<number>`count(distinct coalesce(${questCompletions.userId}, ''))::int`,
    })
    .from(questCompletions)
    .where(isNull(questCompletions.voidedAt));
  return row?.n ?? 0;
}

export type VolunteerCount = {
  userId: string | null;
  name: string | null;
  n: number;
};

export async function completionsByVolunteer(): Promise<VolunteerCount[]> {
  const { questCompletions, confirmations, user } = schema;
  const n = sql<number>`count(*)::int`;
  return getDb()
    .select({ userId: confirmations.confirmedBy, name: user.name, n })
    .from(questCompletions)
    .innerJoin(
      confirmations,
      eq(confirmations.id, questCompletions.confirmationId),
    )
    .leftJoin(user, eq(user.id, confirmations.confirmedBy))
    .where(isNull(questCompletions.voidedAt))
    .groupBy(confirmations.confirmedBy, user.name)
    .orderBy(desc(n));
}

// The interval comes only from bucketIntervalSql's whitelist, and goes in as a
// bound parameter rather than SQL text.
const dateBin = (size: string, column: SQLWrapper) =>
  sql`date_bin(${bucketIntervalSql(size)}::interval, ${column}, ${BUCKET_ORIGIN.toISOString()}::timestamptz)`;

export type CompletionBucket = {
  bucket: Date;
  class: string | null;
  n: number;
};

/** Live completions per bucket and quest class, for [from, to). */
export async function completionSeries(
  size: string,
  from: Date,
  to: Date,
): Promise<CompletionBucket[]> {
  const { questCompletions, quests } = schema;
  const bucket = dateBin(size, questCompletions.confirmedAt);
  const rows = await getDb()
    .select({
      bucket: bucket.mapWith(String),
      class: quests.class,
      n: sql<number>`count(*)::int`,
    })
    .from(questCompletions)
    .innerJoin(quests, eq(quests.id, questCompletions.questId))
    .where(
      and(
        isNull(questCompletions.voidedAt),
        gte(questCompletions.confirmedAt, from),
        lt(questCompletions.confirmedAt, to),
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

/** Live level events awarded before `to`, for the cumulative level view. */
export async function liveLevelEventsBefore(
  to: Date,
): Promise<DatedLevelEvent[]> {
  const { levelEvents } = schema;
  const rows = await getDb()
    .select({
      userId: levelEvents.userId,
      class: levelEvents.class,
      level: levelEvents.level,
      awardedAt: levelEvents.awardedAt,
    })
    .from(levelEvents)
    .where(
      and(
        isNull(levelEvents.voidedAt),
        isNotNull(levelEvents.userId),
        lt(levelEvents.awardedAt, to),
      ),
    );
  return rows.filter((r): r is DatedLevelEvent => r.userId !== null);
}

export type OverrideRow = {
  id: string;
  playerName: string | null;
  class: string;
  level: number;
  awardedByName: string | null;
  awardedAt: Date;
  overrideReason: string | null;
  voidedAt: Date | null;
};

/** Volunteer level-ups recorded despite failing checks, newest first. */
export async function recentOverrides(limit = 20): Promise<OverrideRow[]> {
  const { levelEvents } = schema;
  const player = alias(schema.user, "player");
  const awarder = alias(schema.user, "awarder");
  return getDb()
    .select({
      id: levelEvents.id,
      playerName: player.name,
      class: levelEvents.class,
      level: levelEvents.level,
      awardedByName: awarder.name,
      awardedAt: levelEvents.awardedAt,
      overrideReason: levelEvents.overrideReason,
      voidedAt: levelEvents.voidedAt,
    })
    .from(levelEvents)
    .leftJoin(player, eq(player.id, levelEvents.userId))
    .leftJoin(awarder, eq(awarder.id, levelEvents.awardedBy))
    .where(
      and(
        eq(levelEvents.checksPassed, false),
        eq(levelEvents.source, "volunteer"),
      ),
    )
    .orderBy(desc(levelEvents.awardedAt))
    .limit(limit);
}

export type VoidRow = {
  kind: "confirmation" | "completion" | "level";
  id: string;
  voidedAt: Date;
  voidedByName: string | null;
  reason: string | null;
  questTitle: string | null;
  playerName: string | null;
  class: string | null;
  level: number | null;
};

/**
 * Whole confirmations undone, single completions voided before their
 * confirmation was (if it was), and volunteer level-ups undone, newest first.
 * Picker rows voided by a class switch are left out.
 */
export async function recentVoids(limit = 20): Promise<VoidRow[]> {
  const { confirmations, questCompletions, quests, levelEvents } = schema;
  const db = getDb();
  const voider = alias(schema.user, "voider");
  const player = alias(schema.user, "player");
  const [whole, single, levels] = await Promise.all([
    db
      .select({
        id: confirmations.id,
        voidedAt: confirmations.voidedAt,
        voidedByName: voider.name,
        reason: confirmations.voidReason,
        questTitle: quests.title,
      })
      .from(confirmations)
      .innerJoin(quests, eq(quests.id, confirmations.questId))
      .leftJoin(voider, eq(voider.id, confirmations.voidedBy))
      .where(isNotNull(confirmations.voidedAt))
      .orderBy(desc(confirmations.voidedAt))
      .limit(limit),
    db
      .select({
        id: questCompletions.id,
        voidedAt: questCompletions.voidedAt,
        voidedByName: voider.name,
        reason: questCompletions.voidReason,
        questTitle: quests.title,
        playerName: player.name,
      })
      .from(questCompletions)
      .innerJoin(
        confirmations,
        eq(confirmations.id, questCompletions.confirmationId),
      )
      .innerJoin(quests, eq(quests.id, questCompletions.questId))
      .leftJoin(voider, eq(voider.id, questCompletions.voidedBy))
      .leftJoin(player, eq(player.id, questCompletions.userId))
      .where(
        and(
          isNotNull(questCompletions.voidedAt),
          or(
            isNull(confirmations.voidedAt),
            lt(questCompletions.voidedAt, confirmations.voidedAt),
          ),
        ),
      )
      .orderBy(desc(questCompletions.voidedAt))
      .limit(limit),
    db
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
        and(
          isNotNull(levelEvents.voidedAt),
          eq(levelEvents.source, "volunteer"),
        ),
      )
      .orderBy(desc(levelEvents.voidedAt))
      .limit(limit),
  ]);
  const blank = {
    questTitle: null,
    playerName: null,
    class: null,
    level: null,
  };
  const rows: VoidRow[] = [
    ...whole.map((r) => ({ ...blank, ...r, kind: "confirmation" as const })),
    ...single.map((r) => ({ ...blank, ...r, kind: "completion" as const })),
    ...levels.map((r) => ({ ...blank, ...r, kind: "level" as const })),
  ].flatMap(({ voidedAt, ...r }) => (voidedAt ? [{ ...r, voidedAt }] : []));
  return rows
    .sort((a, b) => b.voidedAt.getTime() - a.voidedAt.getTime())
    .slice(0, limit);
}

/** Every row of an event table, voided ones included, oldest first. */
export async function exportEventTable(
  table: EventTable,
): Promise<{ columns: string[]; rows: unknown[][] }> {
  const { confirmations, questCompletions, levelEvents } = schema;
  const db = getDb();
  const keys = (fields: Record<string, unknown>) => Object.keys(fields);
  const snake = (k: string) =>
    k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  const shape = (fields: Record<string, unknown>, rows: object[]) => ({
    columns: keys(fields).map(snake),
    rows: rows.map((r) =>
      keys(fields).map((k) => (r as Record<string, unknown>)[k]),
    ),
  });

  if (table === "confirmations") {
    const fields = {
      id: confirmations.id,
      questId: confirmations.questId,
      requestedUserIds: confirmations.requestedUserIds,
      confirmedBy: confirmations.confirmedBy,
      createdAt: confirmations.createdAt,
      voidedAt: confirmations.voidedAt,
      voidedBy: confirmations.voidedBy,
      voidReason: confirmations.voidReason,
    };
    const rows = await db
      .select(fields)
      .from(confirmations)
      .orderBy(asc(confirmations.createdAt));
    return shape(fields, rows);
  }
  if (table === "quest_completions") {
    const fields = {
      id: questCompletions.id,
      confirmationId: questCompletions.confirmationId,
      questId: questCompletions.questId,
      userId: questCompletions.userId,
      confirmedAt: questCompletions.confirmedAt,
      voidedAt: questCompletions.voidedAt,
      voidedBy: questCompletions.voidedBy,
      voidReason: questCompletions.voidReason,
    };
    const rows = await db
      .select(fields)
      .from(questCompletions)
      .orderBy(asc(questCompletions.confirmedAt));
    return shape(fields, rows);
  }
  const fields = {
    id: levelEvents.id,
    userId: levelEvents.userId,
    class: levelEvents.class,
    level: levelEvents.level,
    source: levelEvents.source,
    awardedBy: levelEvents.awardedBy,
    awardedAt: levelEvents.awardedAt,
    checksPassed: levelEvents.checksPassed,
    overrideReason: levelEvents.overrideReason,
    cardPhotoUrl: levelEvents.cardPhotoUrl,
    note: levelEvents.note,
    voidedAt: levelEvents.voidedAt,
    voidedBy: levelEvents.voidedBy,
    voidReason: levelEvents.voidReason,
  };
  const rows = await db
    .select(fields)
    .from(levelEvents)
    .orderBy(asc(levelEvents.awardedAt));
  return shape(fields, rows);
}
