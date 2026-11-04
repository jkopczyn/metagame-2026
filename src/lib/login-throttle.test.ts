import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";

const client = new PGlite();
const db = drizzle({ client, schema, casing: "snake_case" });
vi.mock("@/db", () => ({ getDb: () => db, schema }));

const { beginLoginAttempt, clientIp, LOGIN_LIMITS } =
  await import("./login-throttle");

const EMAIL = "ada@example.com";
const IP = "203.0.113.7";

/** Runs `before` ahead of each select reaching the database. */
function onSelect(before: () => Promise<void>) {
  const query = client.query.bind(client) as (
    ...args: unknown[]
  ) => Promise<unknown>;
  return vi.spyOn(client, "query").mockImplementation((async (
    ...args: unknown[]
  ) => {
    if (/^select/i.test(String(args[0]))) await before();
    return query(...args);
  }) as typeof client.query);
}

/**
 * `n` simultaneous attempts, with every count held until all `n` have reached
 * it: the worst interleaving, and one the query queue's order can't hide.
 */
async function race(n: number) {
  let arrived = 0;
  let open = () => {};
  const gate = new Promise<void>((resolve) => (open = resolve));
  const spy = onSelect(async () => {
    if (++arrived === n) open();
    await gate;
  });
  try {
    return await Promise.all(
      Array.from({ length: n }, () => beginLoginAttempt("password", EMAIL, IP)),
    );
  } finally {
    spy.mockRestore();
  }
}

/** `n` attempts, each left standing as a failure. */
async function fail(
  n: number,
  factor: "password" | "code",
  email: (i: number) => string,
  ip: string | null = IP,
) {
  for (let i = 0; i < n; i++) {
    expect(await beginLoginAttempt(factor, email(i), ip)).not.toBeNull();
  }
}

beforeAll(async () => {
  await client.exec(`
    create table verification (
      id text primary key,
      identifier text not null,
      value text not null,
      expires_at timestamptz not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`);
});

beforeEach(async () => {
  await client.exec("delete from verification");
});

describe("beginLoginAttempt", () => {
  it("refuses an address once its failures reach the limit", async () => {
    await fail(LOGIN_LIMITS.password.email, "password", () => EMAIL);
    expect(await beginLoginAttempt("password", EMAIL, IP)).toBeNull();
    // Another address on the same network is unaffected.
    expect(
      await beginLoginAttempt("password", "bob@example.com", IP),
    ).not.toBeNull();
  });

  it("keeps code sign-in working when password tries run out", async () => {
    await fail(LOGIN_LIMITS.password.email, "password", () => EMAIL);
    expect(await beginLoginAttempt("password", EMAIL, IP)).toBeNull();
    expect(await beginLoginAttempt("code", EMAIL, IP)).not.toBeNull();
  });

  it("lets a venue's worth of people fail from one IP before the IP limit", async () => {
    // Seeded, because running this many sign-ins would outlast the test timeout.
    await client.exec(`
      insert into verification (id, identifier, value, expires_at)
      select 'seed-' || n, 'login-attempt:password:ip:${IP}', 'password',
        now() + interval '15 minutes'
      from generate_series(1, ${LOGIN_LIMITS.password.ip - 1}) n`);
    expect(
      await beginLoginAttempt("password", "last@example.com", IP),
    ).not.toBeNull();
    expect(
      await beginLoginAttempt("password", "next@example.com", IP),
    ).toBeNull();
    expect(
      await beginLoginAttempt("password", "next@example.com", "198.51.100.1"),
    ).not.toBeNull();
    expect(
      await beginLoginAttempt("code", "next@example.com", IP),
    ).not.toBeNull();
  });

  it("doesn't count successes or released attempts", async () => {
    for (let i = 0; i < LOGIN_LIMITS.password.email * 2; i++) {
      const attempt = await beginLoginAttempt("password", EMAIL, IP);
      await attempt!.release();
    }
    expect(await beginLoginAttempt("password", EMAIL, IP)).not.toBeNull();
  });

  it("forgets an address's failures once it proves ownership", async () => {
    await fail(LOGIN_LIMITS.password.email, "password", () => EMAIL);
    const code = await beginLoginAttempt("code", EMAIL, IP);
    await code!.succeeded();
    expect(await beginLoginAttempt("password", EMAIL, IP)).not.toBeNull();
  });

  it("doesn't fail a right credential when clearing its failures fails", async () => {
    const attempt = await beginLoginAttempt("password", EMAIL, IP);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(db, "delete").mockImplementationOnce(() => {
      throw new Error("connection reset");
    });
    await expect(attempt!.succeeded()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("recovers when the window passes, and doesn't extend it on refusals", async () => {
    await fail(LOGIN_LIMITS.password.email, "password", () => EMAIL);
    expect(await beginLoginAttempt("password", EMAIL, IP)).toBeNull();
    const { rows } = await client.query<{ n: number }>(
      "select count(*)::int as n from verification where identifier like '%:email:%'",
    );
    expect(rows[0].n).toBe(LOGIN_LIMITS.password.email);
    await client.exec(
      "update verification set expires_at = now() - interval '1 second'",
    );
    expect(await beginLoginAttempt("password", EMAIL, IP)).not.toBeNull();
    const after = await client.query<{ n: number }>(
      "select count(*)::int as n from verification",
    );
    expect(after.rows[0].n).toBe(2);
  });

  it("doesn't leave a failure behind when the count itself fails", async () => {
    const spy = onSelect(async () => {
      throw new Error("connection reset");
    });
    await expect(beginLoginAttempt("password", EMAIL, IP)).rejects.toThrow();
    spy.mockRestore();
    const { rows } = await client.query<{ n: number }>(
      "select count(*)::int as n from verification",
    );
    expect(rows[0].n).toBe(0);
  });

  it("admits parallel guesses up to the limit", async () => {
    const results = await race(LOGIN_LIMITS.password.email);
    expect(results.every(Boolean)).toBe(true);
  });

  it("holds the limit against parallel guesses past it", async () => {
    const results = await race(LOGIN_LIMITS.password.email * 3);
    expect(results.filter(Boolean)).toHaveLength(0);
    // The refused ones took their reservations back, so it isn't a lockout.
    expect(await beginLoginAttempt("password", EMAIL, IP)).not.toBeNull();
  });

  it("works without a known IP", async () => {
    await fail(LOGIN_LIMITS.code.email, "code", () => EMAIL, null);
    expect(await beginLoginAttempt("code", EMAIL, null)).toBeNull();
  });
});

describe("clientIp", () => {
  it("takes the first forwarded address", () => {
    expect(
      clientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })),
    ).toBe("203.0.113.7");
    expect(clientIp(new Headers())).toBeNull();
  });
});
