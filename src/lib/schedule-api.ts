// Schedule-specific plumbing for the JSON API: host resolution and DB-error
// responses. The permission gate and body parsing live in admin-api and are
// re-exported for the schedule routes.

import { revalidatePath } from "next/cache";
import { error } from "./admin-api";
import {
  toPacificWall,
  type ScheduleAccount,
  type ScheduleSession,
} from "./schedule";
import { type Invalid, type Raw } from "./schedule-input";
import {
  ensureAccount,
  explainDbError,
  findAccount,
  querySchedule,
} from "./schedule-store";

export { authorize, error, json, readBody } from "./admin-api";

/** `explainDbError` as a response: a constraint is the caller's fault. */
export function failed(err: unknown): Response {
  const { field, error: message } = explainDbError(err);
  if (field) return error(message, 400, field);
  // Anything else may be raw SQL; keep it in the logs.
  console.error("[admin api] write failed:", err);
  return error("Couldn't save.", 500);
}

export function done() {
  revalidatePath("/backstage/schedule");
}

export type HostInput = { email: string; name?: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Host user ids, lead first, from `{email, name?}` entries. An unknown email
 * needs a name, which makes the account (as the form's "add someone" does).
 */
export async function resolveHosts(
  input: unknown,
): Promise<{ ids: string[] } | Invalid> {
  if (!Array.isArray(input)) {
    return { field: "hosts", error: "hosts must be a list of {email, name}." };
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of input) {
    const { email, name } = parseHost(entry);
    if (!email || !EMAIL.test(email)) {
      return { field: "hosts", error: "Each host needs a valid email." };
    }
    if (seen.has(email)) continue;
    seen.add(email);
    const account = await accountFor(email, name, "hosts");
    if ("error" in account) return account;
    ids.push(account.userId);
  }
  return { ids };
}

/**
 * The shepherd's user id: `byId` (the parsed `shepherdUserId`) when given,
 * else from `{email, name?}` resolved like a host; null clears it.
 */
export async function resolveShepherd(
  input: unknown,
  byId: string | null | undefined,
): Promise<{ id: string | null } | Invalid> {
  if (byId !== undefined) return { id: byId };
  if (input === null || input === undefined) return { id: null };
  const { email, name } = parseHost(input);
  if (!email || !EMAIL.test(email)) {
    return {
      field: "shepherd",
      error: "shepherd must be {email, name} with a valid email, or null.",
    };
  }
  const account = await accountFor(email, name, "shepherd");
  return "error" in account ? account : { id: account.userId };
}

async function accountFor(
  email: string,
  name: string,
  field: string,
): Promise<ScheduleAccount | Invalid> {
  const account = await findAccount(email);
  if (account) return account;
  if (!name) {
    return {
      field,
      error: `No account for ${email}; give a name to create one.`,
    };
  }
  return ensureAccount(name, email);
}

function parseHost(entry: unknown): { email: string; name: string } {
  if (!entry || typeof entry !== "object") return { email: "", name: "" };
  const { email, name } = entry as Record<string, unknown>;
  return {
    email: typeof email === "string" ? email.trim().toLowerCase() : "",
    name: typeof name === "string" ? name.trim() : "",
  };
}

export async function sessionBySlug(
  slug: string,
): Promise<ScheduleSession | null> {
  const { sessions } = await querySchedule();
  return sessions.find((s) => s.slug === slug) ?? null;
}

/** A stored session as the API takes it, so a PATCH can merge over it. */
export function sessionToRaw(session: ScheduleSession): Raw {
  const { hosts, shepherd, startsAt, endsAt, ...rest } = session;
  return {
    ...rest,
    startsAt: startsAt && toPacificWall(startsAt),
    endsAt: endsAt && toPacificWall(endsAt),
    hosts: hosts.map(({ email, name }) => ({ email, name })),
    shepherd: shepherd && { email: shepherd.email, name: shepherd.name },
  };
}
