// Wipes a dev database and rebuilds it: drops the public and drizzle schemas,
// replays every migration, then seeds. Nothing about the Neon branch changes
// (same endpoint, same connection string), so it also cures a schema that an
// abandoned preview migrated ahead of main. Refuses prod and needs --yes.
//
//   DATABASE_URL=<dev branch> pnpm db:reset --yes
//
// The "Reset dev DB" workflow runs exactly this against the shared dev branch.
import { execFileSync } from "node:child_process";
import { neon } from "@neondatabase/serverless";
import { routeLocalDatabase } from "../src/db/local-endpoint.mjs";
import { loadDbEnv, refuseProductionDatabase } from "./lib/db-env.mjs";

loadDbEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[db:reset] DATABASE_URL not set");
  process.exit(1);
}
const host = refuseProductionDatabase("db:reset", url);
if (!process.argv.includes("--yes")) {
  console.error(
    `[db:reset] would drop every table on ${host}; pass --yes to confirm`,
  );
  process.exit(1);
}

routeLocalDatabase(url);
const sql = neon(url);
await sql.query("drop schema if exists drizzle cascade");
await sql.query("drop schema public cascade");
await sql.query("create schema public");
console.log(`[db:reset] dropped and recreated public on ${host}`);

const run = (script, ...args) =>
  execFileSync(process.execPath, [script, ...args], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
run("scripts/db-migrate.mjs");
run("scripts/db-seed.mjs", "--yes");
