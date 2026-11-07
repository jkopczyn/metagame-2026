import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
// Relative so drizzle-kit resolves it without the "@/" alias.
import { HAT_IDS } from "../../lib/hat-tricks-hats";
import { user } from "./auth";

export const hatSteals = pgTable(
  "hat_steals",
  {
    id: uuid().primaryKey().defaultRandom(),
    hatId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    stolenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    recordedBy: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("hat_steals_hat_stolen_at_idx").on(t.hatId, t.stolenAt),
    check(
      "hat_steals_hat_id_known",
      sql`${t.hatId} in (${sql.raw(HAT_IDS.map((id) => `'${id}'`).join(", "))})`,
    ),
  ],
);

// One row, holding the whole schedule as JSON in the format parseSchedule reads.
export const hatSchedule = pgTable(
  "hat_schedule",
  {
    id: integer().primaryKey().default(1),
    shifts: text().notNull(),
    // Bumped by every save, so a stale tab can't overwrite a newer schedule.
    version: integer().notNull().default(1),
    updatedBy: text().references(() => user.id, { onDelete: "set null" }),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("hat_schedule_single_row", sql`${t.id} = 1`)],
);
