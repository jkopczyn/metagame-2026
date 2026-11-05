// One command to a working app in any checkout or worktree: `pnpm dev:local`.
// Each checkout gets its own embedded database and ports. Migrates, seeds until
// one seed has finished, then runs `next dev`. The seed accounts in
// scripts/db-seed.mjs can sign in. `rm -rf .local-db` starts over.
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { connect } from "node:net";
import { basename, join, resolve } from "node:path";
import {
  claimFile,
  databaseOwner,
  inspectCheckout,
  isPortFree,
  listProcesses,
  reapWhenGone,
  replaceFile,
} from "./lib/dev-local-state.mjs";

const DATA_DIR = resolve(".local-db");
const STATE_FILE = join(DATA_DIR, "dev-local.json");
const SEEDED_FILE = join(DATA_DIR, ".seeded");
const ENV_FILE = ".env.local";

const fail = (message) => {
  console.error(`[dev:local] ${message}`);
  process.exit(1);
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

if (!process.features.typescript) {
  fail(`the seed needs Node 22.18 or newer; this is ${process.version}`);
}

// Stable per checkout, so a worktree keeps its URL between runs.
async function freePort(salt) {
  const hash = createHash("sha256")
    .update(process.cwd() + salt)
    .digest();
  for (let port = 3100 + (hash.readUInt16BE(0) % 2000); ; port++) {
    if (await isPortFree(port)) return port;
  }
}

async function waitForPort(port) {
  for (let attempt = 0; attempt < 600; attempt++) {
    const open = await new Promise((done) => {
      const socket = connect(port, "127.0.0.1")
        .once("connect", () => {
          socket.destroy();
          done(true);
        })
        .once("error", () => done(false));
    });
    if (open) return;
    await sleep(100);
  }
  throw new Error(`[dev:local] nothing listening on port ${port}`);
}

const signalGroup = (pgid, signal) => {
  try {
    process.kill(-pgid, signal);
    return true;
  } catch {
    return false;
  }
};

async function stopGroups(groups) {
  groups.forEach((pgid) => signalGroup(pgid, "SIGTERM"));
  for (let attempt = 0; attempt < 50; attempt++) {
    if (!groups.some((pgid) => signalGroup(pgid, 0))) return;
    await sleep(100);
  }
  groups.forEach((pgid) => signalGroup(pgid, "SIGKILL"));
}

function parseState(contents) {
  try {
    return JSON.parse(contents);
  } catch {
    return null;
  }
}

async function takeCheckout() {
  mkdirSync(DATA_DIR, { recursive: true });
  const claim = claimFile(
    STATE_FILE,
    JSON.stringify({ pid: process.pid, groups: [] }),
    (contents) => {
      const state = parseState(contents);
      return (
        state?.pid !== process.pid &&
        inspectCheckout(listProcesses(), state).ownerRunning
      );
    },
  );
  if (claim.busy) {
    fail(`another dev:local is starting here; if none is: rm ${claim.busy}`);
  }
  const previous = parseState(claim.previous);
  if (!claim.claimed) {
    const where = previous.appPort
      ? ` at http://localhost:${previous.appPort}`
      : "";
    fail(
      `already running in this checkout${where}; stop it with: kill ${previous.pid}`,
    );
  }
  const found = inspectCheckout(listProcesses(), previous);
  if (found.leftoverGroups.length > 0) {
    console.log(
      `[dev:local] stopping what an earlier run left behind (process groups ${found.leftoverGroups.join(", ")})`,
    );
    await stopGroups(found.leftoverGroups);
  }
  const database = databaseOwner(DATA_DIR);
  if (database) {
    fail(
      `another database is using ${DATA_DIR}; stop it with: kill ${database}`,
    );
  }
  // Setup can die anywhere: mid-initdb or between a migration's statements, which
  // neon-http doesn't wrap in a transaction. Until it has finished once, the
  // directory holds nothing worth keeping and may not be resumable. The claim
  // files stay, or a concurrent start could take the checkout too.
  const unfinished = readdirSync(DATA_DIR).filter(
    (name) => !name.startsWith(basename(STATE_FILE)),
  );
  if (unfinished.length > 0 && !existsSync(SEEDED_FILE)) {
    console.log("[dev:local] the last setup didn't finish; starting it over");
    for (const name of unfinished) {
      rmSync(join(DATA_DIR, name), { recursive: true, force: true });
    }
  }
}

const existing = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
const current = existing.match(/^DATABASE_URL=(.*)$/m)?.[1];
if (current && !current.includes("@127.0.0.1:")) {
  fail(`${ENV_FILE} sets DATABASE_URL to a non-local database; use pnpm dev`);
}

await takeCheckout();

const groups = new Set();
let appPort;
let dbPort;
const saveState = () =>
  replaceFile(
    STATE_FILE,
    JSON.stringify({
      pid: process.pid,
      appPort,
      dbPort,
      groups: [...groups],
    }),
  );

let stopping = false;
async function shutdown(code) {
  if (stopping) return;
  stopping = true;
  await stopGroups([...groups]);
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("SIGHUP", () => shutdown(0));
process.on("exit", () => {
  groups.forEach((pgid) => signalGroup(pgid, "SIGTERM"));
  rmSync(STATE_FILE, { force: true });
});

// Each child leads its own process group so a stop also reaches what it spawned
// (next -> next-server). The watcher covers SIGKILL of this process,
// when no handler can run.
function start(command, args, env) {
  const child = spawn(command, args, {
    stdio: ["ignore", "inherit", "inherit"],
    detached: true,
    env,
  });
  groups.add(child.pid);
  saveState();
  const watcher = spawn("sh", ["-c", reapWhenGone(process.pid, child.pid)], {
    detached: true,
    stdio: "ignore",
  });
  watcher.unref();
  child.once("exit", () => watcher.kill());
  return child;
}

dbPort = await freePort("db");
appPort = Number(process.env.PORT) || (await freePort("app"));
if (!(await isPortFree(appPort))) {
  fail(`port ${appPort} is in use; free it or unset PORT`);
}
const databaseUrl = `postgres://local:local@127.0.0.1:${dbPort}/local`;

let envFile = existing.replace(/^DATABASE_URL=.*\n?/m, "");
if (envFile && !envFile.endsWith("\n")) envFile += "\n";
envFile += `DATABASE_URL=${databaseUrl}\n`;
if (!/^BETTER_AUTH_SECRET=\S/m.test(envFile)) {
  envFile = envFile.replace(/^BETTER_AUTH_SECRET=.*\n?/m, "");
  envFile += `BETTER_AUTH_SECRET=${randomBytes(32).toString("hex")}\n`;
}
writeFileSync(ENV_FILE, envFile);

try {
  execFileSync("git", ["config", "--get", "core.hooksPath"], { stdio: "pipe" });
} catch {
  console.log(
    "[dev:local] the pre-commit hook is off; turn it on with: git config core.hooksPath .githooks",
  );
}

const env = { ...process.env, DATABASE_URL: databaseUrl };

const db = start(
  process.execPath,
  ["scripts/local-db-server.mjs", DATA_DIR, String(dbPort)],
  env,
);
db.once("exit", () => {
  groups.delete(db.pid);
  if (stopping) return;
  console.error("[dev:local] the local database stopped");
  shutdown(1);
});
await waitForPort(dbPort);

const runScript = (...args) =>
  new Promise((done) => {
    const script = start(process.execPath, args, env);
    script.once("exit", (code) => {
      groups.delete(script.pid);
      saveState();
      if (code === 0) return done();
      if (stopping) return;
      console.error(
        `[dev:local] ${args[0]} failed; rm -rf .local-db rebuilds the database`,
      );
      shutdown(1);
    });
  });
await runScript("scripts/db-migrate.mjs");
// A marker, not the data dir's existence: the database appears before seeding,
// so an interrupted first seed would otherwise never be retried.
if (!existsSync(SEEDED_FILE)) {
  await runScript("scripts/db-seed.mjs", "--yes");
  writeFileSync(SEEDED_FILE, "");
}

const next = start(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev", "-p", String(appPort)],
  env,
);
next.once("exit", (code) => {
  if (stopping) return;
  console.error("[dev:local] next dev stopped");
  shutdown(code ?? 1);
});
await waitForPort(appPort);
console.log(
  `[dev:local] http://localhost:${appPort} (admin@metagame.games / metagame)`,
);
