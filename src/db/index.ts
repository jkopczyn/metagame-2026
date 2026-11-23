import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { fetchWithin } from "@/lib/fetch-timeout";
import { env } from "@/env";
import { routeLocalDatabase } from "./local-endpoint.mjs";
import * as schema from "./schema";

export type Db = NeonHttpDatabase<typeof schema>;

let cached: Db | null = null;

/**
 * Drizzle over Neon's HTTP driver — one fetch per query, no connection pool to
 * manage, which suits Vercel's serverless functions. Built lazily so modules
 * can import this without a DATABASE_URL (local dev without a DB, tests).
 */
export function getDb(): Db {
  if (cached) return cached;
  neonConfig.fetchFunction = fetchWithin(15_000);
  const url = env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set — see .env.example");
  }
  routeLocalDatabase(url);
  cached = drizzle({ client: neon(url), schema, casing: "snake_case" });
  return cached;
}

export { schema };
