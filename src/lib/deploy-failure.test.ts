import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import {
  describeMigrationFailure,
  formatDeployAlert,
  notifyDeployFailure,
  readMigrations,
  reportMigrationFailure,
} from "../../scripts/lib/deploy-failure.mjs";

vi.mock("@/env", () => ({ env: {} }));
vi.mock("@/lib/email", () => ({ sendAdminErrorEmail: vi.fn() }));

const SEP = "--> statement-breakpoint\n";
const FILES = {
  "0000_a": `CREATE TABLE "a" ("id" int);${SEP}UPDATE "a" SET "id" = 1;`,
  "0001_b": `CREATE TABLE "b" ("id" int);${SEP}UPDATE "b" SET "id" = 2;${SEP}BOOM;${SEP}CREATE TABLE "b2" ("id" int);`,
  "0002_c": `CREATE TABLE "c" ("id" int);`,
};

let dir: string;
let folder: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "deploy-failure-"));
  folder = join(dir, "drizzle");
  mkdirSync(join(folder, "meta"), { recursive: true });
  const tags = Object.keys(FILES) as (keyof typeof FILES)[];
  writeFileSync(
    join(folder, "meta/_journal.json"),
    JSON.stringify({
      entries: tags.map((tag, i) => ({ idx: i, tag, when: (i + 1) * 1000 })),
    }),
  );
  for (const tag of tags) writeFileSync(join(folder, `${tag}.sql`), FILES[tag]);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** The real neon-http migrator over a fake Neon client, as db-migrate.mjs runs it. */
async function runMigrate({
  fail = (() => undefined) as (query: string) => unknown,
  lastCreatedAt = null as number | null,
} = {}) {
  const attempted: string[] = [];
  const sent: string[] = [];
  const client = async (query: string) => {
    sent.push(query);
    const failure = fail(query);
    if (failure) throw failure;
    return {
      rows:
        query.startsWith("select id") && lastCreatedAt
          ? [{ id: 1, hash: "h", created_at: lastCreatedAt }]
          : [],
    };
  };
  const db = drizzle({
    client: client as never,
    logger: {
      logQuery: (query: string) => {
        attempted.push(query);
      },
    },
  });
  const error = await migrate(db, { migrationsFolder: folder }).then(
    () => undefined,
    (e: unknown) => e,
  );
  return { attempted, sent, error };
}

const pgError = (message: string, code: string) =>
  Object.assign(new Error(message), { code });
const failOn = (needle: string, error: unknown) => (query: string) =>
  query.includes(needle) ? error : undefined;

describe("the neon-http migrator, which the reports assume", () => {
  it("commits statements as it goes and records nothing after a failure", async () => {
    const { sent, error } = await runMigrate({
      fail: failOn("BOOM", pgError("syntax error", "42601")),
    });
    expect(error).toBeDefined();
    expect(sent.join()).toContain('CREATE TABLE "b"');
    expect(sent.join()).not.toContain('CREATE TABLE "c"');
    expect(sent.join()).not.toContain("insert into");
    expect(sent.join().toUpperCase()).not.toMatch(/\bBEGIN\b/);
  });

  it("records every migration, last, on success", async () => {
    const { sent, error } = await runMigrate();
    expect(error).toBeUndefined();
    expect(sent.slice(-3).every((q) => q.startsWith("insert into"))).toBe(true);
  });

  it("is read the same way by readMigrations", () => {
    const ours = readMigrations(folder);
    const theirs = readMigrationFiles({ migrationsFolder: folder });
    expect(
      ours.map((m: { hash: string; statements: string[]; when: number }) => ({
        hash: m.hash,
        sql: m.statements,
        folderMillis: m.when,
      })),
    ).toEqual(
      theirs.map(({ hash, sql, folderMillis }) => ({
        hash,
        sql,
        folderMillis,
      })),
    );
  });

  it("reads the repo's own migrations the same way too", () => {
    const ours = readMigrations("drizzle");
    const theirs = readMigrationFiles({ migrationsFolder: "drizzle" });
    expect(ours.map((m: { hash: string }) => m.hash)).toEqual(
      theirs.map((m) => m.hash),
    );
  });
});

describe("describeMigrationFailure", () => {
  const describeRun = async (options: Parameters<typeof runMigrate>[0]) => {
    const { attempted, error } = await runMigrate(options);
    return describeMigrationFailure(error, attempted, readMigrations(folder));
  };
  const hash = (tag: number) => readMigrations(folder)[tag].hash;

  it("says what committed and how to repair a mid-migration failure", async () => {
    const { state, recovery } = await describeRun({
      fail: failOn("BOOM", pgError("syntax error", "42601")),
    });
    expect(state).toContain(
      "Failed at 0001_b, statement 3 of 4: syntax error (code 42601)",
    );
    expect(state).toContain(
      "Committed by this run: all of 0000_a; 0001_b statements 1-2.",
    );
    expect(state).toContain(
      "Not applied by this run: 0001_b statements 3-4; 0002_c.",
    );
    expect(state).toContain("Deploys stay blocked");
    expect(state).toContain("restarts at 0000_a");
    expect(recovery).toContain("undo its statements 1-2");
    const [complete, onlyIfFinished] = recovery.split("-- only if");
    expect(complete).toContain(`select '${hash(0)}', 1000 where not exists`);
    expect(complete).not.toContain(hash(1));
    expect(onlyIfFinished).toContain(`select '${hash(1)}', 2000`);
  });

  it("starts from the last recorded migration", async () => {
    const { state, recovery } = await describeRun({
      lastCreatedAt: 1000,
      fail: failOn("BOOM", pgError("syntax error", "42601")),
    });
    expect(state).toContain("Committed by this run: 0001_b statements 1-2.");
    expect(state).toContain("restarts at 0001_b");
    expect(recovery).not.toContain(hash(0));
  });

  it("needs no repair when the first statement fails", async () => {
    const { state, recovery } = await describeRun({
      fail: failOn('CREATE TABLE "a"', pgError("permission denied", "42501")),
    });
    expect(state).toContain("This run committed nothing");
    expect(state).not.toContain("Deploys stay blocked");
    expect(recovery).toContain("left nothing to repair");
    expect(recovery).not.toContain("insert into");
  });

  it("points a retry's 'already exists' at the earlier run", async () => {
    const { state, recovery } = await describeRun({
      fail: failOn(
        'CREATE TABLE "a"',
        pgError('relation "a" already exists', "42P07"),
      ),
    });
    expect(state).toContain("an earlier failed run");
    expect(recovery).toContain("follow that run's report");
  });

  it("doesn't claim a statement rolled back when no Postgres error came back", async () => {
    const { state, recovery } = await describeRun({
      fail: failOn("BOOM", new Error("fetch failed")),
    });
    expect(state).toContain("Unknown: no Postgres error came back");
    expect(state).toContain(
      "Not applied by this run: 0001_b statement 4; 0002_c.",
    );
    expect(recovery).toContain("Check whether statement 3 of 0001_b committed");
  });

  it("gives recording SQL when only the recording failed", async () => {
    const { state, recovery } = await describeRun({
      fail: failOn("insert into", new Error("fetch failed")),
    });
    expect(state).toContain("Every statement of 0000_a, 0001_b, 0002_c");
    for (const i of [0, 1, 2]) expect(recovery).toContain(hash(i));
    expect(recovery).toContain("where not exists");
  });

  it("reports an unreachable database as nothing having run", async () => {
    const { state } = await describeRun({
      fail: failOn("CREATE SCHEMA", new Error("fetch failed")),
    });
    expect(state).toContain("No migration statement ran");
    expect(state).toContain("fetch failed");
  });

  it("admits it when the run doesn't match the files", () => {
    const { state } = describeMigrationFailure(
      pgError("nope", "42601"),
      ["s1", "s2", "s3", "unrelated"],
      readMigrations(folder),
    );
    expect(state).toContain("what it committed is unknown");
  });

  it("flattens the error and leaves out row values in its detail", () => {
    const error = Object.assign(new Error("line one\n::error::line two"), {
      code: "23505",
      detail: "Key (email)=(a@example.com) already exists.",
    });
    const { state, recovery } = describeMigrationFailure(
      error,
      ["s1", "s2", "s3", 'CREATE TABLE "a" ("id" int);'],
      readMigrations(folder),
    );
    expect(state + recovery).not.toContain("a@example.com");
    expect(state).toContain("line one ::error::line two");
  });
});

describe("connection strings in driver errors", () => {
  const SECRET = "synthetic-password";

  it.each([
    `postgres://u:${SECRET}@`,
    `postgresql://u:${SECRET}`,
    `postgres://u:${SECRET.replace("-", " ")}@ho st/db`,
    `no-scheme-${SECRET}`,
  ])("hides what the real driver quotes for %s", async (url) => {
    const attempted: string[] = [];
    const error = await migrate(
      drizzle({
        client: neon(url),
        logger: { logQuery: (query) => attempted.push(query) },
      }),
      { migrationsFolder: folder },
    ).catch((e: unknown) => e);
    expect(String((error as Error).cause)).toContain(url);

    const { state, recovery } = describeMigrationFailure(
      error,
      attempted,
      readMigrations(folder),
    );
    const secretPart = SECRET.split(/[- ]/)[1];
    expect(state + recovery).not.toContain(secretPart);
    expect(state).toContain("not a valid URL");
    expect(state).toContain("No migration statement ran");
  });

  it("hides the configured URL and any other URL wherever they appear", () => {
    const configured = `postgres://u:${SECRET}@db.example/x\nmore`;
    vi.stubEnv("DATABASE_URL", configured);
    const { state } = describeMigrationFailure(
      new Error(`bad ${configured} and https://a:${SECRET}@b.example/ end`),
      [],
      null,
    );
    expect(state).not.toContain(SECRET);
    expect(state).not.toContain("more");
    expect(state).toContain("bad ");
    expect(state).toContain(" end");
  });

  it("keeps it out of the log, summary and alert end to end", async () => {
    const summary = join(dir, "summary.md");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const url = `postgres://u:${SECRET}@`;
    const error = await migrate(drizzle({ client: neon(url) }), {
      migrationsFolder: folder,
    }).catch((e: unknown) => e);
    reportMigrationFailure(error, [], folder, {
      GITHUB_STEP_SUMMARY: summary,
      RUNNER_TEMP: dir,
    });
    const alert = formatDeployAlert({
      RUNNER_TEMP: dir,
      MIGRATE_OUTCOME: "failure",
    });
    expect(
      [
        readFileSync(summary, "utf8"),
        alert,
        ...logged.mock.calls.flat(),
      ].join(),
    ).not.toContain(SECRET);
    expect(alert).toContain("[connection string hidden]");
  });

  it("keeps it out of the log when the report itself can't be built", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error(`(connection string: x:${SECRET})`);
    Object.defineProperty(error, "code", {
      get() {
        throw new Error("boom");
      },
    });
    reportMigrationFailure(error, [], folder, {});
    expect(logged.mock.calls[0]).toContain("[connection string hidden]");
    expect(logged.mock.calls.flat().join()).not.toContain(SECRET);
  });
});

describe("scripts/db-migrate.mjs", () => {
  const runScript = (databaseUrl?: string) =>
    spawnSync(
      process.execPath,
      [join(process.cwd(), "scripts/db-migrate.mjs")],
      {
        cwd: dir,
        encoding: "utf8",
        env: {
          NODE_ENV: "test",
          RUNNER_TEMP: dir,
          ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
        },
      },
    );

  it("still gets a sensible alert when the journal check stops it", () => {
    const journal = join(folder, "meta/_journal.json");
    const { entries } = JSON.parse(readFileSync(journal, "utf8"));
    entries[2].when = 1;
    writeFileSync(journal, JSON.stringify({ entries }));

    const run = runScript();
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("bad migration journal");

    const alert = formatDeployAlert({
      RUNNER_TEMP: dir,
      MIGRATE_OUTCOME: "failure",
    });
    expect(alert).toContain("Database migrations failed");
    expect(alert).toContain("the database state is unknown");
    expect(alert).toContain("Read the step's log");
    expect(alert).not.toContain("recovery steps");
  });

  it("reports a URL that doesn't parse without printing it", () => {
    const run = runScript("not a url synthetic-password");
    expect(run.status).toBe(1);
    expect(run.stdout + run.stderr).not.toContain("synthetic-password");
    expect(run.stderr).toContain("No migration statement ran");
    const alert = formatDeployAlert({
      RUNNER_TEMP: dir,
      MIGRATE_OUTCOME: "failure",
    });
    expect(alert).not.toContain("synthetic-password");
    expect(alert).toContain("No migration statement ran");
  });
});

describe("the production workflow", () => {
  it("checks out before anything that can fail, so the alert script exists", () => {
    const workflow = readFileSync(
      ".github/workflows/vercel-production.yml",
      "utf8",
    );
    const steps = workflow.slice(workflow.indexOf("    steps:\n"));
    expect(steps.match(/- (name|uses): (.*)/)?.[2]).toContain(
      "actions/checkout",
    );
  });
});

describe("reportMigrationFailure", () => {
  const quietly = () => vi.spyOn(console, "error").mockImplementation(() => {});

  it("writes the summary and the state for the alert", async () => {
    quietly();
    const { attempted, error } = await runMigrate({
      fail: failOn("BOOM", pgError("syntax error", "42601")),
    });
    const summary = join(dir, "summary.md");
    reportMigrationFailure(error, attempted, folder, {
      GITHUB_STEP_SUMMARY: summary,
      RUNNER_TEMP: dir,
    });
    expect(readFileSync(summary, "utf8")).toContain("insert into");
    const state = readFileSync(join(dir, "migration-failure.txt"), "utf8");
    expect(state).toContain("Failed at 0001_b");
    expect(state).not.toContain("insert into");
  });

  it("still reports when the migration files can't be read", () => {
    const log = quietly();
    reportMigrationFailure(
      pgError("boom", "42601"),
      ["s1", "s2", "s3", "s4"],
      join(dir, "missing"),
      {},
    );
    expect(log.mock.calls.flat().join()).toContain("boom");
  });

  it("never throws when the report can't be saved", () => {
    const log = quietly();
    expect(() =>
      reportMigrationFailure(pgError("boom", "42601"), [], folder, {
        GITHUB_STEP_SUMMARY: join(dir, "no/such/dir/summary.md"),
      }),
    ).not.toThrow();
    expect(log.mock.calls.flat().join()).toContain("boom");
  });
});

const actionsEnv = {
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_REPOSITORY: "org/repo",
  GITHUB_RUN_ID: "42",
  GITHUB_SHA: "abcdef1234567",
  GITHUB_REF_NAME: "main",
};

describe("formatDeployAlert", () => {
  const now = new Date("2026-11-05T10:00:00Z");

  it("carries the migration report and links the run", () => {
    writeFileSync(join(dir, "migration-failure.txt"), "Failed at 0001_b");
    const text = formatDeployAlert(
      { ...actionsEnv, MIGRATE_OUTCOME: "failure", RUNNER_TEMP: dir },
      now,
    );
    expect(text).toContain("Database migrations failed");
    expect(text).toContain("Failed at 0001_b");
    expect(text).toContain("https://github.com/org/repo/actions/runs/42");
    expect(text).toContain("abcdef1 on main");
    expect(text).toContain("2026-11-05 10:00:00 UTC");
  });

  it("says the state is unknown when the migrate step left no report", () => {
    expect(
      formatDeployAlert(
        { ...actionsEnv, MIGRATE_OUTCOME: "failure", RUNNER_TEMP: dir },
        now,
      ),
    ).toContain("database state is unknown");
    expect(
      formatDeployAlert({ ...actionsEnv, MIGRATE_OUTCOME: "failure" }, now),
    ).toContain("database state is unknown");
  });

  it("says migrations are in when only the deploy failed", () => {
    const text = formatDeployAlert(
      {
        ...actionsEnv,
        BUILD_OUTCOME: "success",
        MIGRATE_OUTCOME: "success",
        DEPLOY_OUTCOME: "failure",
      },
      now,
    );
    expect(text).toContain("`vercel deploy` failed");
    expect(text).toContain("applied and recorded");
    expect(text).toContain("DATABASE_URL is unset");
    expect(text).toContain("re-running the workflow is safe");
  });

  it.each([
    ["failure", "The build failed"],
    ["skipped", "A setup step failed"],
  ])(
    "says the database is untouched when build is %s",
    (BUILD_OUTCOME, what) => {
      const text = formatDeployAlert(
        {
          ...actionsEnv,
          BUILD_OUTCOME,
          MIGRATE_OUTCOME: "skipped",
          DEPLOY_OUTCOME: "skipped",
        },
        now,
      );
      expect(text).toContain(what);
      expect(text).toContain("did not change the database");
    },
  );

  it("fits a Discord message", () => {
    writeFileSync(join(dir, "migration-failure.txt"), "x".repeat(5000));
    const text = formatDeployAlert(
      { ...actionsEnv, MIGRATE_OUTCOME: "failure", RUNNER_TEMP: dir },
      now,
    );
    expect(text.length).toBeLessThanOrEqual(2000);
  });

  it("pings the same person as the app's error reports", async () => {
    const { BRIAN_DISCORD_ID } = await import("@/lib/error-report");
    expect(formatDeployAlert(actionsEnv, now)).toContain(
      `<@${BRIAN_DISCORD_ID}>`,
    );
  });
});

describe("notifyDeployFailure", () => {
  const stubFetch = (response: Partial<Response> = { ok: true }) => {
    const fetchMock = vi.fn<
      (url: string, init: RequestInit) => Promise<Partial<Response>>
    >(async () => response);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };
  const logs = () => vi.spyOn(console, "log").mockImplementation(() => {});

  it("posts to the repo secret with mentions limited to one person", async () => {
    logs();
    const fetchMock = stubFetch();
    await notifyDeployFailure(
      { ...actionsEnv, DISCORD_ERROR_WEBHOOK_URL: "https://discord.test/hook" },
      join(dir, "absent"),
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://discord.test/hook");
    const body = JSON.parse(init.body as string);
    expect(body.allowed_mentions).toEqual({ users: ["223327095239999489"] });
    expect(body.content).toContain("Production deploy");
  });

  it("falls back to the pulled env when the secret is unset (empty)", async () => {
    logs();
    const fetchMock = stubFetch();
    const pulled = join(dir, ".env.production.local");
    writeFileSync(
      pulled,
      'OTHER="x"\nDISCORD_ERROR_WEBHOOK_URL="https://discord.test/pulled"\n',
    );
    await notifyDeployFailure(
      { ...actionsEnv, DISCORD_ERROR_WEBHOOK_URL: "" },
      pulled,
    );
    expect(fetchMock.mock.calls[0][0]).toBe("https://discord.test/pulled");
  });

  it.each([
    ["no pulled env", undefined],
    ["a blank pulled value", 'DISCORD_ERROR_WEBHOOK_URL=""\n'],
  ])("warns and skips with %s", async (_name, contents) => {
    const log = logs();
    const fetchMock = stubFetch();
    const pulled = join(dir, "pulled");
    if (contents) writeFileSync(pulled, contents);
    await notifyDeployFailure(
      { ...actionsEnv, DISCORD_ERROR_WEBHOOK_URL: "" },
      pulled,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join()).toContain(
      "::warning::No alert sent: set the DISCORD_ERROR_WEBHOOK_URL repo secret.",
    );
  });

  it("warns rather than failing on a Discord error", async () => {
    const log = logs();
    stubFetch({ ok: false, status: 404 });
    await notifyDeployFailure(
      { ...actionsEnv, DISCORD_ERROR_WEBHOOK_URL: "https://discord.test/hook" },
      join(dir, "absent"),
    );
    expect(log.mock.calls.flat().join()).toContain("Discord responded 404");
  });

  it("doesn't print a malformed webhook to the public log", async () => {
    const log = logs();
    await notifyDeployFailure(
      { ...actionsEnv, DISCORD_ERROR_WEBHOOK_URL: "not a url secret-token" },
      join(dir, "absent"),
    );
    const output = log.mock.calls.flat().join();
    expect(output).toContain("::warning::");
    expect(output).not.toContain("secret-token");
  });
});
