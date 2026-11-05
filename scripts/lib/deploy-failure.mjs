// Node built-ins only: the alert has to run even when the install step failed.
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

const TABLE = "drizzle.__drizzle_migrations";
// What the neon-http migrator runs before any migration: create schema, create
// table, read the last row.
const SETUP_QUERIES = 3;
const RECORDING_QUERY = /^insert into "drizzle"\."__drizzle_migrations"/;
// "Already exists" and "does not exist": what replaying a committed statement
// usually fails with.
const LEFTOVER_CODES = new Set([
  "42P07",
  "42701",
  "42710",
  "42P01",
  "42703",
  "42704",
]);
const HIDDEN = "[connection string hidden]";
const DISCORD_MESSAGE_LIMIT = 2000;
// Same person as BRIAN_DISCORD_ID in src/lib/error-report.ts.
const BRIAN_DISCORD_ID = "223327095239999489";

/** Reads migrations the way drizzle's readMigrationFiles does, keeping the tag. */
export function readMigrations(folder) {
  const { entries } = JSON.parse(
    readFileSync(join(folder, "meta/_journal.json"), "utf8"),
  );
  return entries.map(({ tag, when }) => {
    const text = readFileSync(join(folder, `${tag}.sql`), "utf8");
    return {
      tag,
      when,
      hash: createHash("sha256").update(text).digest("hex"),
      statements: text.split("--> statement-breakpoint"),
    };
  });
}

/** The migrations this run was working through, found from what it attempted. */
function findPending(migrations, attempted) {
  for (let start = 0; start < migrations.length; start++) {
    const pending = migrations.slice(start);
    const flat = pending.flatMap((m) => m.statements);
    if (attempted.every((statement, i) => flat[i] === statement))
      return pending;
  }
  return null;
}

const statementRange = (from, to) =>
  from === to ? `statement ${from}` : `statements ${from}-${to}`;

const recordSql = ({ hash, when }) =>
  `insert into ${TABLE} (hash, created_at) select '${hash}', ${when} ` +
  `where not exists (select 1 from ${TABLE} where created_at = ${when});`;

const RECORD_RULE =
  "Only the highest created_at counts: the next run skips everything at or below it.";

/**
 * The driver quotes a malformed DATABASE_URL whole, scheme or not, and it isn't
 * a GitHub secret, so Actions wouldn't mask it in the log.
 */
function errorMessage(error) {
  const url = process.env.DATABASE_URL;
  const message = String((error?.cause ?? error)?.message ?? error);
  return (url ? message.split(url).join(HIDDEN) : message)
    .replace(/\(?connection string:[\s\S]*/i, HIDDEN)
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, HIDDEN)
    .replace(/\s+/g, " ")
    .slice(0, 500);
}

/**
 * What a failed `migrate()` left behind. `attempted` is every query the
 * migrator logged, in order. Returns `state` for the alert and `recovery` for
 * the run log; the error's detail is left out because the repo's logs are public
 * and Postgres puts row values there.
 */
export function describeMigrationFailure(error, attempted, migrations) {
  const code = (error?.cause ?? error)?.code;
  const message = errorMessage(error);
  const reason = code ? `${message} (code ${code})` : message;

  const recording = attempted.some((q) => RECORDING_QUERY.test(q));
  const statements = attempted
    .slice(SETUP_QUERIES)
    .filter((q) => !RECORDING_QUERY.test(q));

  if (statements.length === 0)
    return {
      state: `Failed before running any migration statement: ${reason}\nNo migration statement ran, so the schema is unchanged by this run.`,
      recovery: "Fix the cause and re-run the deploy workflow.",
    };

  const pending = migrations && findPending(migrations, statements);
  if (!pending)
    return {
      state: `Failed partway: ${reason}\nCouldn't match the run to drizzle/, so what it committed is unknown. Statements commit one by one and ${TABLE} records nothing until all succeed.`,
      recovery: `Compare the schema with the pending files in drizzle/ before re-running. Record a finished migration in ${TABLE}; a re-run replays everything newer than the highest created_at.`,
    };

  if (recording) {
    const names = pending.map((m) => m.tag).join(", ");
    return {
      state: `Every statement of ${names} committed, but recording them in ${TABLE} failed: ${reason}\nDeploys stay blocked until they are recorded, because the next run would replay them.`,
      recovery: [
        "Run this in the Neon SQL editor for this database, then re-run the deploy workflow.",
        RECORD_RULE,
        ...pending.map(recordSql),
      ].join("\n"),
    };
  }

  // A reply from Postgres means the failed statement rolled back; no reply
  // leaves it unknown, since each one commits on its own.
  const replied = Boolean(code);
  let remaining = statements.length - 1;
  const complete = [];
  const committed = [];
  let failed;
  let failedIndex = 0;
  for (const m of pending) {
    if (remaining >= m.statements.length) {
      complete.push(m);
      committed.push(`all of ${m.tag}`);
      remaining -= m.statements.length;
      continue;
    }
    failed = m;
    failedIndex = remaining;
    if (remaining > 0)
      committed.push(`${m.tag} ${statementRange(1, remaining)}`);
    break;
  }
  const total = failed.statements.length;
  const later = pending.slice(pending.indexOf(failed) + 1).map((m) => m.tag);
  const firstUnrun = failedIndex + (replied ? 1 : 2);
  const unrun = [
    ...(firstUnrun <= total
      ? [`${failed.tag} ${statementRange(firstUnrun, total)}`]
      : []),
    ...later,
  ];
  const anyCommitted = committed.length > 0;

  const state = [
    `Failed at ${failed.tag}, statement ${failedIndex + 1} of ${total}: ${reason}`,
    anyCommitted
      ? `Committed by this run: ${committed.join("; ")}. Statements commit one by one and ${TABLE} records nothing until all succeed, so none of it is recorded.`
      : "This run committed nothing before that statement.",
    ...(replied
      ? []
      : [
          `Unknown: no Postgres error came back for statement ${failedIndex + 1}, so it may have committed.`,
        ]),
    `Not applied by this run: ${unrun.join("; ") || "nothing else pending"}.`,
    ...(LEFTOVER_CODES.has(code)
      ? [
          "This error can mean an earlier failed run already committed the statement, which this run can't see: check that run's report before fixing the migration.",
        ]
      : []),
    ...(anyCommitted
      ? [
          `Deploys stay blocked until this is repaired: each run restarts at ${pending[0].tag}, replaying committed statements (data updates run again) until one fails.`,
        ]
      : []),
    `Deploy was skipped, so the site is still on its previous build${anyCommitted ? ", now on this partly migrated schema: check it's healthy" : ""}.`,
  ].join("\n");

  if (!anyCommitted && replied)
    return {
      state,
      recovery: LEFTOVER_CODES.has(code)
        ? "If an earlier failed run left this behind, follow that run's report. Otherwise fix the cause and deploy again; this run left nothing to repair."
        : "This run left nothing to repair: fix the cause and deploy again.",
    };

  const start = replied
    ? "Fix the cause, then either"
    : `Check whether statement ${failedIndex + 1} of ${failed.tag} committed; no error came back, so the migration may be fine, and if nothing at all committed you can just re-run. Otherwise either`;
  const undo =
    failedIndex > 0 ? `undo its ${statementRange(1, failedIndex)} and ` : "";
  const finishOrUndo = `${start} finish ${failed.tag} by running the rest of it by hand, or ${undo}ship a corrected migration.`;
  const recovery = [
    'In the Neon SQL editor for this database (on the dev database, the "Reset dev DB" workflow is simpler):',
    `1. ${finishOrUndo}`,
    `2. Record what is complete. ${RECORD_RULE}`,
    ...complete.map(recordSql),
    `-- only if you finished ${failed.tag} by hand:`,
    recordSql(failed),
    "3. Re-run the deploy workflow.",
    "Restoring the Neon branch to a point before this run also undoes it, but discards every write since, purchases included.",
  ].join("\n");
  return { state, recovery };
}

const reportPath = (env) =>
  env.RUNNER_TEMP ? join(env.RUNNER_TEMP, "migration-failure.txt") : null;

/**
 * Prints the failure and leaves the state for the alert step. Never throws.
 * @param {Record<string, string | undefined>} [env]
 */
export function reportMigrationFailure(
  error,
  attempted,
  folder,
  env = process.env,
) {
  let report;
  try {
    let migrations = null;
    try {
      migrations = readMigrations(folder);
    } catch {
      // Falls through to the "couldn't match" report.
    }
    report = describeMigrationFailure(error, attempted, migrations);
    const text = `${report.state}\n\nTo recover:\n${report.recovery}`;
    console.error(`[db:migrate] FAILED\n${text}`);
    if (env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        env.GITHUB_STEP_SUMMARY,
        `### Database migration failed\n\n\`\`\`\n${text}\n\`\`\`\n`,
      );
    const path = reportPath(env);
    if (path) writeFileSync(path, report.state);
  } catch (reportError) {
    if (!report) console.error("[db:migrate] FAILED", errorMessage(error));
    console.error("[db:migrate] couldn't write the report:", reportError);
  }
}

function failureSummary(env) {
  if (env.MIGRATE_OUTCOME === "failure") {
    const what = "Database migrations failed, so this commit did not go live.";
    try {
      return {
        what,
        state: readFileSync(reportPath(env), "utf8"),
        next: "Exact recovery steps and SQL are in the run's summary.",
      };
    } catch {
      return {
        what,
        state:
          "The step ended without a report, so the database state is unknown.",
        next: "Read the step's log before re-running. The live site is still on its previous build.",
      };
    }
  }
  if (env.DEPLOY_OUTCOME === "failure")
    return {
      what: "`vercel deploy` failed, so this commit should not be live.",
      state:
        "The migration step passed, so anything pending is applied and recorded (it only skips if DATABASE_URL is unset), and the schema may be ahead of the live build.",
      next: "Check the Vercel dashboard; re-running the workflow is safe, since applied migrations are skipped.",
    };
  return {
    what:
      env.BUILD_OUTCOME === "failure"
        ? "The build failed, so this commit did not go live."
        : "A setup step failed, so this commit did not go live.",
    state:
      "Migrations had not started, so this run did not change the database.",
    next: "The live site is still on its previous build. Fix the cause, or re-run if it looks transient.",
  };
}

/** One Discord message, laid out like formatErrorReport in src/lib/error-report.ts. */
export function formatDeployAlert(env, now = new Date()) {
  const { what, state, next } = failureSummary(env);
  const when = now.toISOString().replace("T", " ").slice(0, 19);
  const run = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  const text = [
    "🚨 **Website error:** Production deploy",
    `<@${BRIAN_DISCORD_ID}>`,
    `📝 **What:** ${what}`,
    `🔹 **Commit:** ${env.GITHUB_SHA?.slice(0, 7)} on ${env.GITHUB_REF_NAME}`,
    `🔹 **Run:** ${run}`,
    `🕒 **When:** ${when} UTC (production)`,
    `🗄️ **Database:**\n${state}`,
    `➡️ **Next:** ${next}`,
  ].join("\n");
  return text.length > DISCORD_MESSAGE_LIMIT
    ? `${text.slice(0, DISCORD_MESSAGE_LIMIT - 1)}…`
    : text;
}

function pulledWebhook(file) {
  try {
    return parseEnv(readFileSync(file, "utf8")).DISCORD_ERROR_WEBHOOK_URL;
  } catch {
    return undefined;
  }
}

/**
 * Posts the alert. Never fails the step: the job is already red.
 * @param {Record<string, string | undefined>} [env]
 */
export async function notifyDeployFailure(
  env = process.env,
  vercelEnvFile = ".vercel/.env.production.local",
) {
  // An unset repo secret reaches the step as "", hence || and not ??.
  const webhook = env.DISCORD_ERROR_WEBHOOK_URL || pulledWebhook(vercelEnvFile);
  if (!webhook) {
    console.log(
      "::warning::No alert sent: set the DISCORD_ERROR_WEBHOOK_URL repo secret.",
    );
    return;
  }
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: formatDeployAlert(env),
        allowed_mentions: { users: [BRIAN_DISCORD_ID] },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    console.log(
      res.ok
        ? "Alert sent to the error channel."
        : `::warning::Couldn't send the alert: Discord responded ${res.status}.`,
    );
  } catch (err) {
    // Only the name: a malformed URL's message quotes the webhook, and these
    // logs are public.
    console.log(`::warning::Couldn't send the alert: ${err.name}.`);
  }
}
