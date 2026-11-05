// Serves Neon's HTTP SQL protocol from an embedded PGlite, so a worktree can run
// the real app, migrations and seed with no account, Docker or shared database.
// Started by scripts/dev-local.mjs. Queries run one at a time, so this can't
// reproduce races between concurrent transactions.
import { createServer } from "node:http";
import { PGlite } from "@electric-sql/pglite";
import { lockDatabase, unlockDatabase } from "./lib/dev-local-state.mjs";

const [dataDir, port] = process.argv.slice(2);
// Two PGlites on one directory corrupt it.
const lock = lockDatabase(dataDir);
if (!lock.claimed) {
  console.error(
    lock.busy
      ? `[local-db] another server is claiming ${dataDir}; if none is: rm ${lock.busy}`
      : `[local-db] ${dataDir} is in use; stop it with: kill ${lock.previous}`,
  );
  process.exit(1);
}
let db;
try {
  db = await PGlite.create(dataDir);
} catch (error) {
  console.error(
    `[local-db] couldn't open ${dataDir} (${error.message}); rm -rf it to rebuild`,
  );
  process.exit(1);
}

// Neon's client sends and receives text and does its own type conversion.
const passthrough = (table) =>
  Object.fromEntries(Object.keys(table).map((oid) => [oid, (value) => value]));
const options = () => ({
  rowMode: "array",
  parsers: passthrough(db.parsers),
  serializers: passthrough(db.serializers),
});

function toNeonResult(result, sql, arrayMode) {
  const names = result.fields.map((field) => field.name);
  return {
    command: sql.trimStart().split(/\s+/, 1)[0].toUpperCase(),
    rowCount: result.affectedRows || result.rows.length,
    rowAsArray: arrayMode,
    fields: result.fields.map((field) => ({
      name: field.name,
      dataTypeID: field.dataTypeID,
      tableID: 0,
      columnID: 0,
      dataTypeSize: -1,
      dataTypeModifier: -1,
      format: "text",
    })),
    rows: arrayMode
      ? result.rows
      : result.rows.map((row) =>
          Object.fromEntries(names.map((name, i) => [name, row[i]])),
        ),
  };
}

async function execute(body, arrayMode) {
  if (!body.queries) {
    const result = await db.query(body.query, body.params ?? [], options());
    return toNeonResult(result, body.query, arrayMode);
  }
  const results = await db.transaction(async (tx) => {
    const out = [];
    for (const { query, params } of body.queries) {
      const result = await tx.query(query, params ?? [], options());
      out.push(toNeonResult(result, query, arrayMode));
    }
    return out;
  });
  return { results };
}

const server = createServer(async (req, res) => {
  let text = "";
  for await (const chunk of req) text += chunk;
  res.setHeader("content-type", "application/json");
  try {
    const arrayMode = req.headers["neon-array-mode"] === "true";
    res.end(JSON.stringify(await execute(JSON.parse(text), arrayMode)));
  } catch (error) {
    const { message, code, detail, constraint, table, column, schema } = error;
    res.statusCode = 400;
    res.end(
      JSON.stringify({
        message,
        code,
        detail,
        constraint,
        table,
        column,
        schema,
      }),
    );
  }
});
server.once("error", (error) => {
  console.error(`[local-db] couldn't listen on port ${port}: ${error.message}`);
  process.exit(1);
});
server.listen(Number(port), "127.0.0.1", () => {
  console.log(`[local-db] listening on 127.0.0.1:${port}`);
});

const stop = async () => {
  server.close();
  await db.close();
  unlockDatabase(dataDir);
  process.exit(0);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
