// Validates drizzle/meta/_journal.json without a database. db:migrate runs the
// same journal check first, so a bad journal stops a deploy before anything applies.
import { readdirSync } from "node:fs";
import {
  assertValidJournal,
  readJournal,
  unlistedMigrations,
} from "./lib/migration-journal.mjs";

const count = assertValidJournal("db:check");
const unlisted = unlistedMigrations(readJournal(), readdirSync("drizzle"));
if (unlisted.length > 0) {
  console.error(
    `[db:check] not in the journal, so they would never run: ${unlisted.join(", ")}`,
  );
  process.exit(1);
}
console.log(`[db:check] journal ok (${count} migrations)`);
