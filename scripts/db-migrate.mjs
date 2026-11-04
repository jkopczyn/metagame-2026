// Applies pending SQL migrations from ./drizzle. Run by the deploy workflows
// between `vercel build` and `vercel deploy` so the schema is ahead of the
// code that needs it, and by hand against a personal Neon branch.
//
// Exits 0 without touching anything when DATABASE_URL is unset, so a deploy
// still works before the database is provisioned.
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { routeLocalDatabase } from "../src/db/local-endpoint.mjs";

// `vercel pull` writes the environment's vars under .vercel/; locally they come
// from .env.local. Vars already in the environment are never overridden.
for (const file of [
  ".env.local",
  ".vercel/.env.production.local",
  ".vercel/.env.preview.local",
]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // file absent
  }
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("[db:migrate] DATABASE_URL not set — skipping migrations");
  process.exit(0);
}

routeLocalDatabase(url);
await migrate(drizzle({ client: neon(url) }), { migrationsFolder: "drizzle" });
console.log("[db:migrate] migrations applied");
