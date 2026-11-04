import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  claimFile,
  databaseOwner,
  inspectCheckout,
  lockDatabase,
  parseProcessList,
  reapWhenGone,
  unlockDatabase,
} from "../../scripts/lib/dev-local-state.mjs";
import { isProductionDatabase } from "../../scripts/lib/db-env.mjs";
import {
  journalProblems,
  unlistedMigrations,
} from "../../scripts/lib/migration-journal.mjs";

describe("reapWhenGone", () => {
  const installed = (shell: string) =>
    spawnSync(shell, ["-c", "true"]).status === 0;

  it.each(["sh", "dash", "bash"].filter(installed))(
    "stops the group under %s once the owner is gone",
    async (shell) => {
      const group = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
      const exited = once(group, "exit");
      try {
        const owner = spawn("sleep", ["0.1"], { stdio: "ignore" });
        spawn(shell, ["-c", reapWhenGone(owner.pid!, group.pid!)], {
          stdio: "ignore",
        });
        const [, signal] = await exited;
        expect(signal).toBe("SIGTERM");
      } finally {
        group.kill("SIGKILL");
      }
    },
    10_000,
  );
});

const entry = (idx: number, when: number, tag = `000${idx}_a`) => ({
  idx,
  when,
  tag,
});
const files = (...entries: { tag: string }[]) =>
  entries.map(({ tag }) => `${tag}.sql`).concat("meta");

describe("journalProblems", () => {
  it("accepts the repo's journal", () => {
    const journal = JSON.parse(
      readFileSync("drizzle/meta/_journal.json", "utf8"),
    );
    expect(journalProblems(journal, readdirSync("drizzle"))).toEqual([]);
  });

  it("accepts a valid journal", () => {
    const entries = [entry(0, 1), entry(1, 2)];
    expect(journalProblems({ entries }, files(...entries))).toEqual([]);
  });

  it.each([
    ["older", 1],
    ["equal", 2],
  ])("rejects a `when` %s than the one before it", (_, when) => {
    const entries = [entry(0, 2), entry(1, when)];
    const problems = journalProblems({ entries }, files(...entries));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/silently skip/);
  });

  it("rejects a gap or duplicate in idx", () => {
    const gap = [entry(0, 1), entry(2, 2)];
    expect(journalProblems({ entries: gap }, files(...gap))).toEqual([
      "0002_a: idx is 2, expected 1",
    ]);
    const duplicate = [entry(0, 1), entry(0, 2, "0001_b")];
    expect(
      journalProblems({ entries: duplicate }, files(...duplicate)),
    ).toEqual(["0001_b: idx is 0, expected 1"]);
  });

  it("rejects a listed migration with no file", () => {
    const entries = [entry(0, 1), entry(1, 2)];
    expect(journalProblems({ entries }, files(entries[0]))).toEqual([
      "0001_a: 0001_a.sql is missing",
    ]);
  });
});

describe("unlistedMigrations", () => {
  it("finds a SQL file the journal doesn't list, and only that", () => {
    const entries = [entry(0, 1)];
    expect(
      unlistedMigrations({ entries }, [...files(...entries), "0001_b.sql"]),
    ).toEqual(["0001_b.sql"]);
    expect(unlistedMigrations({ entries }, files(...entries))).toEqual([]);
  });

  it("doesn't count as a journal problem, so db:migrate still runs", () => {
    const entries = [entry(0, 1)];
    expect(
      journalProblems({ entries }, [...files(...entries), "0001_b.sql"]),
    ).toEqual([]);
  });
});

describe("isProductionDatabase", () => {
  const prod = "postgres://u:p@ep-crimson-sky-b8tcqhxv-pooler.neon.tech/db";
  const dev = "postgres://u:p@ep-other-branch.neon.tech/db";
  const env = (vars: Record<string, string> = {}) =>
    vars as unknown as NodeJS.ProcessEnv;

  it("spots the production endpoint, pooled or not", () => {
    expect(isProductionDatabase(prod, env())).toBe(true);
    expect(isProductionDatabase(prod.replace("-pooler", ""), env())).toBe(true);
  });

  it("treats anything under a production Vercel env as production", () => {
    expect(isProductionDatabase(dev, env({ VERCEL_ENV: "production" }))).toBe(
      true,
    );
  });

  it("lets other databases through", () => {
    expect(isProductionDatabase(dev, env({ VERCEL_ENV: "preview" }))).toBe(
      false,
    );
    expect(
      isProductionDatabase("postgres://l:l@127.0.0.1:5433/local", env()),
    ).toBe(false);
  });
});

describe("inspectCheckout", () => {
  const processes = parseProcessList([
    "  100   100 node scripts/dev-local.mjs",
    "  200   200 node scripts/local-db-server.mjs /repo/.local-db 4000",
    "  201   201 node scripts/local-db-server.mjs /other/.local-db 4001",
    "  300   300 pnpm exec next dev -p 3000",
    "  301   300 next-server (v16)",
    "  400   400 /usr/bin/unrelated",
  ]);

  it("recognises a running owner", () => {
    const state = { pid: 100, groups: [200, 300] };
    expect(inspectCheckout(processes, state).ownerRunning).toBe(true);
  });

  it("doesn't take a reused pid for the owner", () => {
    const state = { pid: 400, groups: [] };
    expect(inspectCheckout(processes, state).ownerRunning).toBe(false);
  });

  it("finds leftovers even when the group leader is gone", () => {
    const survivors = processes.filter(
      (row: { pid: number }) => row.pid !== 300,
    );
    const state = { pid: 999, groups: [200, 300] };
    expect(inspectCheckout(survivors, state).leftoverGroups).toEqual([
      200, 300,
    ]);
  });

  it("never treats a reused pgid as a leftover", () => {
    const state = { pid: 999, groups: [400] };
    expect(inspectCheckout(processes, state).leftoverGroups).toEqual([]);
  });
});

describe("databaseOwner", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "db-lock-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const ps = (command: string) => [
    { pid: process.pid, pgid: process.pid, command },
  ];

  it("finds a server however its path was spelled", () => {
    lockDatabase(dir);
    expect(
      databaseOwner(dir, ps("node scripts/local-db-server.mjs .local-db 4000")),
    ).toBe(process.pid);
  });

  it("finds a real server started with a relative path, until it stops", async () => {
    const server = spawn(
      process.execPath,
      [resolve("scripts/local-db-server.mjs"), ".local-db", "0"],
      { cwd: dir, stdio: ["ignore", "pipe", "inherit"] },
    );
    await once(server.stdout, "data");
    expect(databaseOwner(join(dir, ".local-db"))).toBe(server.pid);
    server.kill();
    await once(server, "exit");
    expect(databaseOwner(join(dir, ".local-db"))).toBeNull();
  }, 60_000);

  it("ignores a dead server's lock, even with its pid reused", () => {
    lockDatabase(dir);
    expect(databaseOwner(dir, [])).toBeNull();
    expect(databaseOwner(dir, ps("/usr/bin/unrelated"))).toBeNull();
  });

  it("finds nothing once unlocked or with no directory", () => {
    lockDatabase(dir);
    unlockDatabase(dir);
    expect(existsSync(join(dir, ".server-pid"))).toBe(false);
    expect(
      databaseOwner(dir, ps("node scripts/local-db-server.mjs . 4000")),
    ).toBeNull();
    expect(databaseOwner(join(dir, "missing"), [])).toBeNull();
  });
});

describe("claimFile", () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "claim-"));
    path = join(dir, "claim");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const leftovers = () => readdirSync(dir).filter((name) => name !== "claim");

  it("claims a free file", () => {
    expect(claimFile(path, "me", () => true)).toEqual({
      claimed: true,
      previous: null,
    });
    expect(readFileSync(path, "utf8")).toBe("me");
    expect(leftovers()).toEqual([]);
  });

  it("leaves a live holder alone", () => {
    writeFileSync(path, "them");
    expect(claimFile(path, "me", () => true)).toEqual({
      claimed: false,
      previous: "them",
    });
    expect(readFileSync(path, "utf8")).toBe("them");
    expect(leftovers()).toEqual([]);
  });

  it("takes over from a dead holder, reporting what it held", () => {
    writeFileSync(path, "them");
    expect(claimFile(path, "me", () => false)).toEqual({
      claimed: true,
      previous: "them",
    });
    expect(readFileSync(path, "utf8")).toBe("me");
    expect(leftovers()).toEqual([]);
  });

  it("backs off while another starter is taking over", () => {
    writeFileSync(path, "them");
    writeFileSync(`${path}.takeover`, "1");
    expect(claimFile(path, "me", () => false)).toEqual({
      claimed: false,
      busy: `${path}.takeover`,
    });
    expect(readFileSync(path, "utf8")).toBe("them");
  });

  const stateModule = pathToFileURL(
    resolve("scripts/lib/dev-local-state.mjs"),
  ).href;
  // Holds any claim until told to exit, so the others see a live holder.
  const starter = `
    import { claimFile } from ${JSON.stringify(stateModule)};
    const alive = (pid) => {
      try { process.kill(Number(pid), 0); return true; } catch { return false; }
    };
    const { claimed } = claimFile(process.argv[1], String(process.pid), alive);
    console.log(claimed ? "claimed" : "refused");
    process.stdin.resume();
    process.stdin.once("end", () => process.exit(0));
  `;

  it.each([
    ["free", false],
    ["held by a dead process", true],
  ])(
    "lets one of many concurrent starters claim a %s file",
    async (_, stale) => {
      for (let round = 0; round < 5; round++) {
        rmSync(path, { force: true });
        if (stale) {
          const dead = spawnSync(process.execPath, ["-e", ""]);
          writeFileSync(path, String(dead.pid));
        }
        const starters = Array.from({ length: 8 }, () =>
          spawn(
            process.execPath,
            ["--input-type=module", "-e", starter, path],
            { stdio: ["pipe", "pipe", "inherit"] },
          ),
        );
        const answers = await Promise.all(
          starters.map(async (child) =>
            String((await once(child.stdout, "data"))[0]).trim(),
          ),
        );
        const winners = starters.filter((_, i) => answers[i] === "claimed");
        expect(winners).toHaveLength(1);
        expect(readFileSync(path, "utf8")).toBe(String(winners[0].pid));
        await Promise.all(
          starters.map((child) => {
            const exited = once(child, "exit");
            child.stdin.end();
            return exited;
          }),
        );
      }
    },
    60_000,
  );

  it("lets only one of many real servers open a directory", async () => {
    const servers = Array.from({ length: 4 }, () =>
      spawn(
        process.execPath,
        [resolve("scripts/local-db-server.mjs"), ".local-db", "0"],
        { cwd: dir, stdio: ["ignore", "pipe", "ignore"] },
      ),
    );
    const exits = servers.map((server) => once(server, "exit"));
    const listening = await Promise.race(
      servers.map(async (server) => {
        await once(server.stdout, "data");
        return server;
      }),
    );
    const codes = await Promise.all(
      servers
        .map((server, i) => ({ server, exit: exits[i] }))
        .filter(({ server }) => server !== listening)
        .map(async ({ exit }) => (await exit)[0]),
    );
    expect(codes).toEqual([1, 1, 1]);
    expect(databaseOwner(join(dir, ".local-db"))).toBe(listening.pid);
    listening.kill();
    await Promise.all(exits);
  }, 60_000);
});

describe("db-drift", () => {
  let dir: string;
  const writeSchema = (body: string) =>
    writeFileSync(
      join(dir, "schema.ts"),
      `import { pgTable, text } from "drizzle-orm/pg-core";\n${body}\n`,
    );
  const drift = () =>
    spawnSync(
      process.execPath,
      [
        resolve("scripts/db-drift.mjs"),
        "--dialect=postgresql",
        "--schema=schema.ts",
        "--out=drizzle",
      ],
      { cwd: dir, encoding: "utf8" },
    ).status;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "db-drift-"));
    symlinkSync(resolve("node_modules"), join(dir, "node_modules"));
    writeSchema(`export const a = pgTable("a", { one: text() });`);
    // The first run writes the baseline migration, which counts as drift.
    expect(drift()).toBe(1);
  }, 60_000);
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it.each([
    ["no change", `export const a = pgTable("a", { one: text() });`, 0],
    [
      "a new column",
      `export const a = pgTable("a", { one: text(), two: text() });`,
      1,
    ],
    // drizzle-kit exits 0 on these, having generated nothing.
    ["a renamed table", `export const a = pgTable("b", { one: text() });`, 1],
    ["a renamed column", `export const a = pgTable("a", { two: text() });`, 1],
    ["a schema that can't load", `throw new Error("broken");`, 1],
  ])(
    "on %s",
    (_, schema, status) => {
      writeSchema(schema);
      expect(drift()).toBe(status);
    },
    60_000,
  );
});
