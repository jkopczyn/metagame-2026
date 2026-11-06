import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

// Attendee-editable profile fields, kept apart from Better Auth's `user` table
// so nothing security-relevant (role, ban state) sits next to a form field.
export const profiles = pgTable(
  "profiles",
  {
    userId: text()
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    pronouns: text(),
    discordHandle: text(),
    bio: text(),
    isPublic: boolean().notNull().default(false),
    imageUrl: text(),
    isAdult: boolean(),
    bringingChildren: boolean(),
    shareWithRecruiters: boolean(),
    website: text(),
    // Megagame class levels, 0–5.
    wizardLevel: smallint().notNull().default(0),
    pirateLevel: smallint().notNull().default(0),
    alienLevel: smallint().notNull().default(0),
    // The number printed on the Megagame badge, 0–9999. Assigned elsewhere.
    badgeNumber: integer().unique(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check("profiles_image_url_https", sql`${t.imageUrl} like 'https://%'`),
    check("profiles_wizard_level_range", sql`${t.wizardLevel} between 0 and 5`),
    check("profiles_pirate_level_range", sql`${t.pirateLevel} between 0 and 5`),
    check("profiles_alien_level_range", sql`${t.alienLevel} between 0 and 5`),
    check(
      "profiles_badge_number_range",
      sql`${t.badgeNumber} between 0 and 9999`,
    ),
  ],
);
