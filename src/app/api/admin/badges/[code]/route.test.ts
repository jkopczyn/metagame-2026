import { beforeEach, expect, it, vi } from "vitest";
// Better Auth and the permission store are faked; the gate in access.ts and
// admin-auth.ts is real, so these run the x-api-key path end to end.
const auth = vi.hoisted(() => ({
  headers: new Headers(),
  /** key → the permissions its account holds */
  keys: {} as Record<string, string[]>,
}));
vi.mock("next/headers", () => ({ headers: async () => auth.headers }));
vi.mock("@/lib/auth", () => ({
  API_KEY_HEADER: "x-api-key",
  accountsConfigured: () => true,
  accountLabel: (user: { name: string }) => user.name,
  getAuth: () => ({
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const key = headers.get("x-api-key") ?? "";
        return key in auth.keys
          ? { user: { id: key, name: "Libi", role: "user" } }
          : null;
      },
      verifyApiKey: async ({ body }: { body: { key: string } }) => ({
        valid: body.key in auth.keys,
      }),
    },
  }),
}));
vi.mock("@/lib/permission-store", () => ({
  userAccess: async (userId: string) => ({
    admin: false,
    roles: [],
    grants: auth.keys[userId],
    roleIds: [],
  }),
}));
vi.mock("@/lib/megagame-store", () => ({
  findPlayerByBadgeNumber: vi.fn(),
}));
import { GET } from "./route";
import { findPlayerByBadgeNumber } from "@/lib/megagame-store";

const KEY = "mg_tickets";
const get = (code: string, key: string | null = KEY) => {
  auth.headers = new Headers(key ? { "x-api-key": key } : {});
  return GET(new Request(`https://metagame.games/api/admin/badges/${code}`), {
    params: Promise.resolve({ code }),
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.keys = { [KEY]: ["tickets.view"], mg_promo: ["promo.view"] };
  vi.mocked(findPlayerByBadgeNumber).mockImplementation(async (n) =>
    n === 42
      ? {
          id: "u42",
          name: "Ada Lovelace",
          pronouns: null,
          imageUrl: null,
          levels: { wizard: 0, pirate: 0, alien: 0 },
        }
      : null,
  );
});

it("needs a key whose account holds tickets.view", async () => {
  expect((await get("0042", null)).status).toBe(401);
  expect((await get("0042", "mg_revoked")).status).toBe(401);
  const other = await get("0042", "mg_promo");
  expect(other.status).toBe(403);
  expect((await other.json()).error).toContain("tickets.view");
  expect(findPlayerByBadgeNumber).not.toHaveBeenCalled();
});

it("returns the attendee's name, with the code zero-padded", async () => {
  const res = await get("42");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    badgeCode: "0042",
    userId: "u42",
    name: "Ada Lovelace",
  });
});

it("404s an unassigned badge and 400s a non-number", async () => {
  const missing = await get("0007");
  expect(missing.status).toBe(404);
  expect((await missing.json()).error).toBe(
    "No attendee has badge number 0007.",
  );
  expect((await get("abc")).status).toBe(400);
  expect((await get("12345")).status).toBe(400);
});
