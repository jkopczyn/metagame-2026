import { jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamps, user } from "./auth";

// Shared drafts for the sign maker at /backstage/signs. `sign` is the tool's
// own document (src/app/backstage/signs/README.md); photos and fonts it
// references live in Vercel Blob, so a row stays small.
export const signDrafts = pgTable("sign_drafts", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  sign: jsonb().notNull(),
  // Tiny data URL for the drafts list.
  thumbnail: text(),
  createdBy: text().references(() => user.id, { onDelete: "set null" }),
  updatedBy: text().references(() => user.id, { onDelete: "set null" }),
  ...timestamps,
});
