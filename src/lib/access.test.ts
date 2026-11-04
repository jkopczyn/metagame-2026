import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { admin } from "better-auth/plugins";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A real Better Auth over an in-memory database, so these pin what the access
// check relies on from the library rather than a stand-in's behaviour.
const db: Record<string, Record<string, unknown>[]> = {
  user: [],
  session: [],
  account: [],
  verification: [],
};
const auth = betterAuth({
  baseURL: "http://localhost:3000",
  secret: "a-test-secret-a-test-secret-a-test-secret",
  database: memoryAdapter(db),
  emailAndPassword: { enabled: true },
  session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
  plugins: [admin()],
});

// In the app nextCookies() hands these to cookies().set(), and any such write
// during a server action makes Next re-render the route.
let written: string[] = [];
async function getSession(args: {
  headers: Headers;
  query?: { disableCookieCache?: boolean; disableRefresh?: boolean };
}) {
  const { headers, response } = await auth.api.getSession({
    ...args,
    returnHeaders: true,
  });
  written.push(...headers.getSetCookie());
  return response;
}

const requestHeaders = vi.hoisted(() => ({ current: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => requestHeaders.current,
}));
vi.mock("./auth", () => ({
  accountsConfigured: () => true,
  getAuth: () => ({ api: { getSession } }),
}));
vi.mock("./permission-store", () => ({ userAccess: vi.fn(async () => ({})) }));
vi.mock("./permissions", () => ({
  effectivePermissions: () => new Set(["schedule.manage"]),
  hasTeamPermission: () => true,
  PERMISSION_KEYS: ["schedule.manage"],
}));

const { can, teamAccess } = await import("./access");

const row = (table: string) => db[table][db[table].length - 1];
const expiry = () => (row("session").expiresAt as Date).getTime();
const ageSession = (days: number) => {
  row("session").expiresAt = new Date(expiry() - days * 24 * 60 * 60 * 1000);
};
/** The cookies a browser would send once the five-minute cookie cache lapsed. */
const withoutCookieCache = () =>
  new Headers({
    cookie: requestHeaders.current
      .get("cookie")!
      .split("; ")
      .filter((c) => !c.includes("session_data"))
      .join("; "),
  });

let n = 0;
beforeEach(async () => {
  const email = `person${n++}@example.com`;
  const password = "metagame-test";
  await auth.api.signUpEmail({ body: { email, password, name: "Test" } });
  const { headers } = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const cookie = headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  requestHeaders.current = new Headers({ cookie });
  written = [];
});

describe("the access check", () => {
  it("reads the account without writing a cookie", async () => {
    expect(await can("schedule.manage")).not.toBeNull();
    expect(written).toEqual([]);
  });

  it("neither writes one nor extends a session due a refresh", async () => {
    ageSession(2);
    const before = expiry();
    expect(await teamAccess()).not.toBeNull();
    expect(written).toEqual([]);
    expect(expiry()).toBe(before);
  });

  it("applies a ban at once, through a still-valid cookie cache", async () => {
    expect(await teamAccess()).not.toBeNull();
    row("user").banned = true;
    expect(await teamAccess()).toBeNull();
    expect(await can("schedule.manage")).toBeNull();
  });

  it("applies a revoke at once, through a still-valid cookie cache", async () => {
    expect(await teamAccess()).not.toBeNull();
    db.session.pop();
    expect(await teamAccess()).toBeNull();
  });

  it("refuses an expired session", async () => {
    ageSession(30);
    expect(await teamAccess()).toBeNull();
  });
});

describe("without disableRefresh", () => {
  it("skipping the cookie cache alone writes a cookie, which is the re-render", async () => {
    await getSession({
      headers: requestHeaders.current,
      query: { disableCookieCache: true },
    });
    expect(written.join()).toContain("session_data");
  });

  it("the plain read currentSession() makes extends a session due a refresh", async () => {
    ageSession(2);
    const before = expiry();
    await getSession({ headers: withoutCookieCache() });
    expect(expiry()).toBeGreaterThan(before);
    expect(written.join()).toContain("session_token");
  });
});
