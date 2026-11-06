import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamps, user } from "./auth";

// References to quests are restrict, not cascade: the event
// tables are history, and quests.active is how a quest is withdrawn.

export const quests = pgTable(
  "quests",
  {
    id: uuid().primaryKey().defaultRandom(),
    code: text().notNull().unique(),
    title: text().notNull(),
    // Null means any class. Text, not an enum, so renaming a class needs no migration.
    class: text(),
    kind: text().notNull(),
    answers: text()
      .array()
      .notNull()
      .default(sql`'{}'`),
    evidence: text(),
    hint: text(),
    minLevel: integer(),
    maxLevel: integer(),
    active: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [
    check("quests_kind_known", sql`${t.kind} in ('answer', 'evidence')`),
    check(
      "quests_level_window_needs_class",
      sql`${t.class} is not null or (${t.minLevel} is null and ${t.maxLevel} is null)`,
    ),
  ],
);

// One row per player and quest. A volunteer's confirmation sets status to
// 'completed'; undo puts it back to 'attempted' and records who and why.
export const questProgress = pgTable(
  "quest_progress",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    questId: uuid()
      .notNull()
      .references(() => quests.id, { onDelete: "restrict" }),
    status: text().notNull(),
    attemptCount: integer().notNull().default(0),
    firstAttemptAt: timestamp({ withTimezone: true }),
    completedAt: timestamp({ withTimezone: true }),
    confirmedBy: text().references(() => user.id, { onDelete: "set null" }),
    undoneAt: timestamp({ withTimezone: true }),
    undoneBy: text().references(() => user.id, { onDelete: "set null" }),
    undoReason: text(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("quest_progress_user_quest_unique").on(t.userId, t.questId),
    index("quest_progress_quest_id_idx").on(t.questId),
    index("quest_progress_confirmed_by_idx").on(t.confirmedBy),
    check(
      "quest_progress_status_known",
      sql`${t.status} in ('attempted', 'completed')`,
    ),
  ],
);

export const levelEvents = pgTable(
  "level_events",
  {
    // Client-generated, the idempotency key for the level-up action.
    id: uuid().primaryKey(),
    userId: text().references(() => user.id, { onDelete: "set null" }),
    class: text().notNull(),
    level: integer().notNull(),
    // 'picker' for the /account faction picker, 'volunteer' for the level-up action.
    source: text().notNull(),
    awardedBy: text().references(() => user.id, { onDelete: "set null" }),
    awardedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    checksPassed: boolean().notNull(),
    overrideReason: text(),
    cardPhotoUrl: text(),
    note: text(),
    voidedAt: timestamp({ withTimezone: true }),
    voidedBy: text().references(() => user.id, { onDelete: "set null" }),
    voidReason: text(),
  },
  (t) => [
    uniqueIndex("level_events_live_unique")
      .on(t.userId, t.class, t.level)
      .where(sql`${t.voidedAt} is null and ${t.userId} is not null`),
    index("level_events_user_id_idx").on(t.userId),
    check("level_events_level_range", sql`${t.level} between 1 and 5`),
    check(
      "level_events_source_known",
      sql`${t.source} in ('picker', 'volunteer')`,
    ),
    check(
      "level_events_card_photo_https",
      sql`${t.cardPhotoUrl} is null or ${t.cardPhotoUrl} like 'https://%'`,
    ),
  ],
);
