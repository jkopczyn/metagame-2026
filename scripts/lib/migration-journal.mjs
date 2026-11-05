import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Drizzle applies a migration only when its journal `when` is newer than the
 * newest one already applied, and silently skips it otherwise. A migration
 * rebased from an old branch keeps its old `when`, so its tables never appear.
 *
 * @param {{ entries: { idx: number, when: number, tag: string }[] }} journal
 * @param {string[]} files names of the files in the migrations folder
 * @returns {string[]} what's wrong; empty when the journal is valid
 */
export function journalProblems(journal, files) {
  const problems = [];
  const present = new Set(files);
  journal.entries.forEach(({ idx, when, tag }, position) => {
    if (idx !== position) {
      problems.push(`${tag}: idx is ${idx}, expected ${position}`);
    }
    if (!present.has(`${tag}.sql`)) {
      problems.push(`${tag}: ${tag}.sql is missing`);
    }
    const previous = journal.entries[position - 1];
    if (previous && !(when > previous.when)) {
      problems.push(
        `${tag}: when ${when} is not after ${previous.tag}'s ${previous.when}, ` +
          "so drizzle would silently skip it on a database that has the earlier " +
          "ones. Delete it and rerun pnpm db:generate on top of main.",
      );
    }
  });
  return problems;
}

/**
 * A SQL file the journal doesn't list never runs. db:check fails on it, but not
 * db:migrate: drizzle ignores such a file, so it's no reason to block a deploy.
 */
export function unlistedMigrations(journal, files) {
  const listed = new Set(journal.entries.map(({ tag }) => `${tag}.sql`));
  return files.filter((file) => file.endsWith(".sql") && !listed.has(file));
}

export const readJournal = (folder = "drizzle") =>
  JSON.parse(readFileSync(join(folder, "meta/_journal.json"), "utf8"));

/** Exits 1 if the folder's journal is invalid; otherwise returns its length. */
export function assertValidJournal(scriptName, folder = "drizzle") {
  const journal = readJournal(folder);
  const problems = journalProblems(journal, readdirSync(folder));
  if (problems.length === 0) return journal.entries.length;
  console.error(`[${scriptName}] bad migration journal:`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
