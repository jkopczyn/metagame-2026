// CI's check that src/db/schema matches the migrations. drizzle-kit generate
// exits 0 without generating anything when it can't finish (a rename it would
// prompt about, a schema that fails to load), so only its explicit no-change
// line passes. On real drift it writes the migration, so this isn't in db:check.
import { spawnSync } from "node:child_process";

const result = spawnSync(
  "node_modules/.bin/drizzle-kit",
  ["generate", ...process.argv.slice(2)],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
if (result.status !== 0 || !result.stdout?.includes("No schema changes")) {
  console.error(
    "::error::Couldn't confirm src/db/schema matches the migrations (output above); run pnpm db:generate and commit what it writes.",
  );
  process.exit(1);
}
