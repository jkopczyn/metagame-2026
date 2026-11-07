import { beforeEach, expect, it, vi } from "vitest";
// Same fakes as referral/route.test.ts: the x-api-key gate is real, the store is not.
const auth = vi.hoisted(() => ({
  headers: new Headers(),
  keys: {} as Record<string, string[]>,
}));
vi.mock("next/headers", () => ({ headers: async () => auth.headers }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
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
vi.mock("@/lib/ticket-store", () => ({ assignBadgeCode: vi.fn() }));
vi.mock("@/lib/checkin-store", () => ({
  badgeTakenMessage: vi.fn(),
  deskTicket: vi.fn(),
}));
import { DELETE, PUT } from "./route";
import { badgeTakenMessage, deskTicket } from "@/lib/checkin-store";
import { assignBadgeCode } from "@/lib/ticket-store";

const KEY = "mg_tickets";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const put = (id: string, body: unknown, key: string | null = KEY) => {
  auth.headers = new Headers(key ? { "x-api-key": key } : {});
  return PUT(
    new Request(`https://metagame.games/api/admin/tickets/${id}/badge`, {
      method: "PUT",
      headers: auth.headers,
      body: JSON.stringify(body),
    }),
    ctx(id),
  );
};
const del = (id: string, key: string | null = KEY) => {
  auth.headers = new Headers(key ? { "x-api-key": key } : {});
  return DELETE(new Request("https://metagame.games"), ctx(id));
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.keys = { [KEY]: ["tickets.edit"], mg_view: ["tickets.view"] };
  vi.mocked(assignBadgeCode).mockImplementation(async (id, code) =>
    id === "pi_nope"
      ? { ok: false, reason: "unknown" }
      : code === 42
        ? { ok: false, reason: "taken" }
        : { ok: true, ticket: {} as never },
  );
  vi.mocked(badgeTakenMessage).mockImplementation(
    async (code) => `Badge ${String(code).padStart(4, "0")} is already on Ada.`,
  );
  vi.mocked(deskTicket).mockImplementation(async (id) =>
    id === "pi_nope"
      ? null
      : ({ status: id === "pi_pending" ? "pending" : "paid" } as never),
  );
});

it("needs a key whose account holds tickets.edit", async () => {
  expect((await put("pi_1", { badgeCode: "7" }, null)).status).toBe(401);
  const view = await put("pi_1", { badgeCode: "7" }, "mg_view");
  expect(view.status).toBe(403);
  expect((await view.json()).error).toContain("tickets.edit");
  expect((await del("pi_1", "mg_view")).status).toBe(403);
  expect(assignBadgeCode).not.toHaveBeenCalled();
});

it("sets the badge from typed digits, leading zeros optional", async () => {
  const res = await put("pi_1", { badgeCode: " 0007 " });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ badgeCode: "0007" });
  expect(assignBadgeCode).toHaveBeenCalledWith("pi_1", 7);
  expect((await put("pi_1", { badgeCode: 7 })).status).toBe(200);
  expect(assignBadgeCode).toHaveBeenLastCalledWith("pi_1", 7);
});

it("only puts a number on a paid ticket", async () => {
  const res = await put("pi_pending", { badgeCode: "7" });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toContain("paid");
  expect(assignBadgeCode).not.toHaveBeenCalled();
});

it("rejects blanks and non-digits before the store sees them", async () => {
  expect((await put("pi_1", { badgeCode: "" })).status).toBe(400);
  const res = await put("pi_1", { badgeCode: "12345" });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({
    error: "A badge code is one to four digits.",
    field: "badgeCode",
  });
  expect(assignBadgeCode).not.toHaveBeenCalled();
});

it("names who wears a taken code", async () => {
  const res = await put("pi_1", { badgeCode: "42" });
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("Badge 0042 is already on Ada.");
});

it("404s a missing ticket", async () => {
  expect((await put("pi_nope", { badgeCode: "7" })).status).toBe(404);
  expect((await del("pi_nope")).status).toBe(404);
});

it("clears the badge", async () => {
  const res = await del("pi_1");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ badgeCode: null });
  expect(assignBadgeCode).toHaveBeenCalledWith("pi_1", null);
});
