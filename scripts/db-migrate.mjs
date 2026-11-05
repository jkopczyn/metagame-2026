// Applies pending SQL migrations from ./drizzle. Run by the deploy workflows
// between `vercel build` and `vercel deploy` so the schema is ahead of the
// code that needs it, and by hand against a personal Neon branch.
//
// Exits 0 without touching anything when DATABASE_URL is unset, so a deploy
// still works before the database is provisioned.
import { reportMigrationFailure } from "./lib/deploy-failure.mjs";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { routeLocalDatabase } from "../src/db/local-endpoint.mjs";
import { loadDbEnv } from "./lib/db-env.mjs";
import { assertValidJournal } from "./lib/migration-journal.mjs";

assertValidJournal("db:migrate");
loadDbEnv({ production: true });

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("[db:migrate] DATABASE_URL not set — skipping migrations");
  process.exit(0);
}

// neon-http has no transactions: each statement commits alone and nothing is
// recorded until all pending migrations succeed, so a failure can leave work
// that blocks every later run. The log of attempts says how far this one got.
const attempted = [];
try {
  routeLocalDatabase(url);
  await migrate(
    drizzle({
      client: neon(url),
      logger: { logQuery: (query) => attempted.push(query) },
    }),
    { migrationsFolder: "drizzle" },
  );
} catch (error) {
  reportMigrationFailure(error, attempted, "drizzle");
  process.exit(1);
}
console.log("[db:migrate] migrations applied");
