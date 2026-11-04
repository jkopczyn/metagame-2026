// One command to a working app in any checkout or worktree: `pnpm dev:local`.
// Each checkout gets its own embedded database and ports. Migrates, seeds once,
// then runs `next dev`. The seed accounts in scripts/db-seed.mjs can sign in.
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { connect, createServer } from "node:net";

const DATA_DIR = ".local-db";
const ENV_FILE = ".env.local";

const isFree = (port) =>
  new Promise((resolve) => {
    const probe = createServer()
      .once("error", () => resolve(false))
      .once("listening", () => probe.close(() => resolve(true)))
      .listen(port, "127.0.0.1");
  });

// Stable per checkout, so a worktree keeps its URL between runs.
async function freePort(salt) {
  const hash = createHash("sha256")
    .update(process.cwd() + salt)
    .digest();
  for (let port = 3100 + (hash.readUInt16BE(0) % 2000); ; port++) {
    if (await isFree(port)) return port;
  }
}

async function waitForPort(port) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const open = await new Promise((resolve) => {
      const socket = connect(port, "127.0.0.1")
        .once("connect", () => {
          socket.destroy();
          resolve(true);
        })
        .once("error", () => resolve(false));
    });
    if (open) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`[dev:local] nothing listening on port ${port}`);
}

const existing = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
const current = existing.match(/^DATABASE_URL=(.*)$/m)?.[1];
if (current && !current.includes("@127.0.0.1:")) {
  console.error(
    `[dev:local] ${ENV_FILE} sets DATABASE_URL to a non-local database; use pnpm dev`,
  );
  process.exit(1);
}

const dbPort = await freePort("db");
const appPort = Number(process.env.PORT) || (await freePort("app"));
const databaseUrl = `postgres://local:local@127.0.0.1:${dbPort}/local`;

let envFile = existing.replace(/^DATABASE_URL=.*\n?/m, "");
if (envFile && !envFile.endsWith("\n")) envFile += "\n";
envFile += `DATABASE_URL=${databaseUrl}\n`;
if (!/^BETTER_AUTH_SECRET=/m.test(envFile)) {
  envFile += `BETTER_AUTH_SECRET=${randomBytes(32).toString("hex")}\n`;
}
writeFileSync(ENV_FILE, envFile);

const firstRun = !existsSync(DATA_DIR);
const children = [];
const stop = () => children.forEach((child) => child.kill());
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("exit", stop);

children.push(
  spawn(
    process.execPath,
    ["scripts/local-db-server.mjs", DATA_DIR, String(dbPort)],
    { stdio: "inherit" },
  ),
);
await waitForPort(dbPort);

const env = { ...process.env, DATABASE_URL: databaseUrl };
const runScript = (...args) =>
  execFileSync(process.execPath, args, { stdio: "inherit", env });
runScript("scripts/db-migrate.mjs");
if (firstRun) runScript("scripts/db-seed.mjs", "--yes");

const next = spawn("pnpm", ["exec", "next", "dev", "-p", String(appPort)], {
  stdio: "inherit",
  env,
});
children.push(next);
next.on("exit", (code) => process.exit(code ?? 0));
console.log(
  `[dev:local] http://localhost:${appPort} (admin@metagame.games / metagame)`,
);
