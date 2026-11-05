import { execFileSync } from "node:child_process";
import {
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

const canListen = (port, host) =>
  new Promise((resolve) => {
    const probe = createServer()
      // A machine without IPv6 fails with something other than EADDRINUSE.
      .once("error", (error) => resolve(error.code !== "EADDRINUSE"))
      .once("listening", () => probe.close(() => resolve(true)))
      .listen(port, host);
  });

// `next dev` binds ::, so a 127.0.0.1-only probe calls its port free.
export async function isPortFree(port) {
  return (await canListen(port, "127.0.0.1")) && (await canListen(port, "::"));
}

/** Parses `ps -A -o pid=,pgid=,command=`. */
export function parseProcessList(output) {
  return output.flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    return match
      ? [{ pid: Number(match[1]), pgid: Number(match[2]), command: match[3] }]
      : [];
  });
}

export const listProcesses = () =>
  parseProcessList(
    execFileSync("ps", ["-A", "-o", "pid=,pgid=,command="], {
      encoding: "utf8",
    }).split("\n"),
  );

/**
 * What an earlier dev:local left in this checkout. The commands are checked as
 * well as the ids, because a pid from an old state file may have been reused.
 */
export function inspectCheckout(processes, state) {
  const running = (pid) =>
    processes.some(
      (row) => row.pid === pid && row.command.includes("dev-local.mjs"),
    );
  const leftoverGroups = (state?.groups ?? []).filter((pgid) =>
    processes.some(
      (row) =>
        row.pgid === pgid &&
        /local-db-server\.mjs|db-migrate\.mjs|db-seed\.mjs|next/.test(
          row.command,
        ),
    ),
  );
  return {
    ownerRunning: state ? running(state.pid) : false,
    leftoverGroups,
  };
}

let temps = 0;
const writeTemp = (path, content) => {
  const temp = `${path}.${process.pid}.${temps++}.tmp`;
  writeFileSync(temp, content);
  return temp;
};

/** Replaces `path` whole, so a reader can't mistake a partial file for a dead owner. */
export function replaceFile(path, content) {
  renameSync(writeTemp(path, content), path);
}

/**
 * Claims `path` for this process unless `isLive(contents)` says its holder is
 * still running. Taking over a dead holder is the racy part: two starters could
 * both judge it dead, and the slower would then replace the winner's fresh
 * claim. So the judgement and the replacement happen under `<path>.takeover`.
 *
 * Returns { claimed: true, previous }, { claimed: false, previous } when a live
 * process holds it, or { claimed: false, busy } when another starter is taking
 * over, where `busy` is the file to remove if that starter died.
 */
export function claimFile(path, content, isLive) {
  const temp = writeTemp(path, content);
  try {
    for (;;) {
      try {
        linkSync(temp, path);
        return { claimed: true, previous: null };
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      const busy = `${path}.takeover`;
      try {
        writeFileSync(busy, String(process.pid), { flag: "wx" });
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        return { claimed: false, busy };
      }
      try {
        let previous;
        try {
          previous = readFileSync(path, "utf8");
        } catch (error) {
          // The holder exited since the link failed.
          if (error.code !== "ENOENT") throw error;
          continue;
        }
        if (isLive(previous)) return { claimed: false, previous };
        renameSync(temp, path);
        return { claimed: true, previous };
      } finally {
        rmSync(busy, { force: true });
      }
    }
  } finally {
    rmSync(temp, { force: true });
  }
}

const lockFile = (dataDir) => join(dataDir, ".server-pid");

const isServer = (pid, processes) =>
  processes.some(
    (row) => row.pid === pid && row.command.includes("local-db-server.mjs"),
  );

/**
 * The live server holding `dataDir`. A lock file rather than matching commands,
 * since a server may have been started with any spelling of the path. The
 * command is checked because a dead server's pid may have been reused.
 */
export function databaseOwner(dataDir, processes = listProcesses()) {
  let pid;
  try {
    pid = Number(readFileSync(lockFile(dataDir), "utf8"));
  } catch {
    return null;
  }
  return isServer(pid, processes) ? pid : null;
}

/** Claims `dataDir` for this process; see claimFile for the result. */
export function lockDatabase(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  return claimFile(lockFile(dataDir), String(process.pid), (contents) => {
    const pid = Number(contents);
    return pid !== process.pid && isServer(pid, listProcesses());
  });
}

export const unlockDatabase = (dataDir) =>
  rmSync(lockFile(dataDir), { force: true });

/** A shell script. `-s TERM`, since dash takes `--` for a pid after `-TERM`. */
export const reapWhenGone = (ownerPid, pgid) =>
  `while kill -0 ${ownerPid} 2>/dev/null; do sleep 2; done; kill -s TERM -- -${pgid} 2>/dev/null`;
