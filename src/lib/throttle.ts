import { sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

type Budget = { limit: number; windowMs: number; global?: true };

const SECOND = 1000;
const TEN_MINUTES = 10 * 60 * SECOND;
const HOUR = 60 * 60 * SECOND;

// Per-IP unless marked global. The whole venue shares one IP during the event,
// so each is sized for 1,000 people at once. That lets one address past
// Airtable's 5 calls a second: refusing the venue is the worse failure.
const BUDGETS = {
  contact: { limit: 1000, windowMs: HOUR },
  signup: { limit: 1000, windowMs: TEN_MINUTES },
  forms: { limit: 1000, windowMs: TEN_MINUTES },
  // Two requests a person: the clue, then their name.
  clue: { limit: 2000, windowMs: TEN_MINUTES },
  codeLookup: { limit: 2000, windowMs: TEN_MINUTES },
  poster: { limit: 1000, windowMs: TEN_MINUTES },
  bitcoinCharge: { limit: 1000, windowMs: HOUR },
  signInCode: { limit: 5000, windowMs: HOUR },
  // Above signInCode, so one address can't use it all up and lock everyone out.
  signInCodeTotal: { limit: 10000, windowMs: HOUR, global: true },
  // A short window: a burst inside a longer one would still hit Airtable's limit.
  // Windows are fixed, so two can land back to back: at 2 a second eggs peak at 4
  // in any one second, leaving purchases one of the 5. At 3 they could reach 6.
  egg: { limit: 2, windowMs: SECOND, global: true },
} satisfies Record<string, Budget>;

export type BudgetName = keyof typeof BUDGETS;

// A slow store shouldn't hold up a sign-in or a purchase any more than a broken one.
const STORE_TIMEOUT_MS = 1500;

// Vercel overwrites x-forwarded-for with the connecting address, so it can't be spoofed.
export function clientIp(headers: Headers): string | null {
  const ip = headers.get("x-forwarded-for")?.split(",")[0].trim();
  if (!ip) return null;
  if (ip.toLowerCase().startsWith("::ffff:")) return ip.slice(7);
  if (!ip.includes(":")) return ip;
  // One IPv6 customer holds a whole /64, so that's the unit that gets a budget.
  const [head, tail] = ip.split("%")[0].toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const zeros = Array(Math.max(0, 8 - left.length - right.length)).fill("0");
  return [...left, ...zeros, ...right]
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ""))
    .join(":");
}

// One statement, so concurrent requests can't both read the same count.
async function spend(
  id: string,
  identifier: string,
  expiresAt: Date,
): Promise<number> {
  const { verification } = schema;
  const [row] = await getDb()
    .insert(verification)
    .values({ id, identifier, value: "1", expiresAt })
    .onConflictDoUpdate({
      target: verification.id,
      set: { value: sql`(${verification.value}::int + 1)::text` },
    })
    .returning({ value: verification.value });
  return Number(row.value);
}

async function spendInTime(
  id: string,
  identifier: string,
  expiresAt: Date,
): Promise<number> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("budget store timed out")),
      STORE_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([spend(id, identifier, expiresAt), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Windows already known to be spent, so a flood stops writing to the database.
const exhausted = new Set<string>();

/**
 * Spends one request from a budget kept in Better Auth's verification table
 * (whose cleanup clears the expired rows); true when none is left. Anything
 * going wrong with the budget itself lets the request through.
 */
export async function overBudget(
  name: BudgetName,
  headers?: Headers,
): Promise<boolean> {
  const budget: Budget = BUDGETS[name];
  const who = budget.global ? "all" : headers && clientIp(headers);
  if (!who) return false;

  const window = Math.floor(Date.now() / budget.windowMs);
  const identifier = `throttle:${name}:${who}`;
  const id = `${identifier}:${window}`;
  if (exhausted.has(id)) return true;

  const expiresAt = new Date((window + 1) * budget.windowMs);
  let spent: number;
  try {
    spent = await spendInTime(id, identifier, expiresAt);
  } catch (err) {
    console.error(`[throttle] ${name}: letting the request through:`, err);
    return false;
  }
  if (spent <= budget.limit) return false;

  console.warn(`[throttle] ${name}: over budget for ${who}`);
  if (exhausted.size >= 1000) exhausted.clear();
  exhausted.add(id);
  return true;
}

/** The 429 to return when this request is over its budget, otherwise null. */
export async function throttled(
  request: Request,
  name: BudgetName,
): Promise<Response | null> {
  if (!(await overBudget(name, request.headers))) return null;
  const { windowMs } = BUDGETS[name];
  const retryAfter = Math.ceil((windowMs - (Date.now() % windowMs)) / 1000);
  return Response.json(
    {
      error: "Too many requests right now. Please try again in a little while.",
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "Cache-Control": "no-store",
      },
    },
  );
}
