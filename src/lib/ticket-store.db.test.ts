import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as schema from "@/db/schema";
import type { PurchaseRecord } from "./airtable";

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", async () => ({
  getDb: () => holder.db,
  schema: await vi.importActual("@/db/schema"),
}));
vi.mock("@/env", () => ({ env: { DATABASE_URL: "pglite" } }));
vi.mock("./airtable", () => ({
  updatePurchaseTicketCode: vi.fn().mockResolvedValue(true),
}));
vi.mock("./email", () => ({ sendAdminErrorEmail: vi.fn() }));

import {
  claimOwnTicket,
  claimTicket,
  hasClaimedTicket,
  markTicketFailed,
  recordTicket,
  unclaimTicket,
} from "./ticket-store";
import { ticketCode } from "./ticket-code";

const { tickets, user } = schema;

let client: PGlite;
let db: PgliteDatabase<typeof schema>;

const purchase = (
  status: PurchaseRecord["status"],
  over: Partial<PurchaseRecord> = {},
): PurchaseRecord => ({
  id: "pi_1",
  status,
  test: false,
  paymentMethod: "stripe",
  customerEmail: "buyer@example.com",
  ...over,
});

const row = async (paymentId = "pi_1") =>
  (await db.select().from(tickets).where(eq(tickets.paymentId, paymentId)))[0];

async function account(id: string) {
  await db.insert(user).values({
    id,
    name: id,
    email: `${id}@example.com`,
    emailVerified: true,
  });
}

beforeAll(async () => {
  client = new PGlite();
  db = drizzle({ client, schema, casing: "snake_case" });
  await migrate(db, {
    migrationsFolder: path.resolve(__dirname, "../../drizzle"),
  });
  holder.db = db;
}, 60_000);

afterAll(() => client.close());

beforeEach(async () => {
  await db.delete(tickets);
  await db.delete(user);
  await db.delete(schema.verification);
});

describe("recordTicket", () => {
  it("creates the row with the derived code and returns it", async () => {
    const stored = await recordTicket(purchase("Pending"));
    expect(stored).toMatchObject({
      status: "Pending",
      ticketCode: ticketCode("pi_1"),
    });
    expect(await row()).toMatchObject({
      status: "pending",
      ticketCode: ticketCode("pi_1"),
      purchaserEmail: "buyer@example.com",
    });
  });

  it.each([
    ["Pending", "Paid", "paid"],
    ["Pending", "Failed", "failed"],
    ["Pending", "Underpaid", "underpaid"],
    ["Underpaid", "Paid", "paid"],
    ["Underpaid", "Pending", "pending"],
    ["Failed", "Paid", "paid"],
  ] as const)("walks %s to %s", async (first, next, expected) => {
    await recordTicket(purchase(first));
    const stored = await recordTicket(purchase(next));
    expect(stored.status).toBe(next);
    expect((await row()).status).toBe(expected);
  });

  it.each([
    ["Paid", "paid"],
    ["Failed", "failed"],
  ] as const)("a late Pending can't undo %s", async (settled, expected) => {
    await recordTicket(purchase(settled));
    const stored = await recordTicket(purchase("Pending"));
    expect(stored.status).toBe(settled);
    expect((await row()).status).toBe(expected);
  });

  it("a late Underpaid can't undo Paid", async () => {
    await recordTicket(purchase("Paid"));
    const stored = await recordTicket(purchase("Underpaid"));
    expect(stored.status).toBe("Paid");
    expect((await row()).status).toBe("paid");
  });

  it("retries a first delivery that lost the race on the code", async () => {
    const raced = new Error("Failed query", {
      cause: Object.assign(new Error("duplicate key"), { code: "23505" }),
    });
    vi.spyOn(db, "insert").mockImplementationOnce(() => {
      throw raced;
    });
    const stored = await recordTicket(purchase("Paid"));
    expect(stored.status).toBe("Paid");
    expect((await row()).status).toBe("paid");
  });

  it("still throws when another payment holds the code", async () => {
    await recordTicket(purchase("Paid"));
    await expect(
      recordTicket(
        purchase("Paid", { id: "pi_2", ticketCode: ticketCode("pi_1") }),
      ),
    ).rejects.toThrow();
    expect(await row("pi_2")).toBeUndefined();
  });

  it("still fills in other fields on a late Pending", async () => {
    await recordTicket(purchase("Paid"));
    await recordTicket(purchase("Pending", { ticketType: "Standard" }));
    expect(await row()).toMatchObject({ status: "paid", tier: "Standard" });
  });

  it("never clobbers with blanks", async () => {
    await recordTicket(purchase("Pending", { ticketType: "Standard" }));
    await recordTicket(purchase("Paid", { customerEmail: undefined }));
    expect(await row()).toMatchObject({
      tier: "Standard",
      purchaserEmail: "buyer@example.com",
    });
  });

  it("a replay after an unclaim returns the reissued code, and doesn't revive the old one", async () => {
    await account("ada");
    const original = (await recordTicket(purchase("Paid"))).ticketCode!;
    await claimTicket("ada", original);
    const unclaimed = await unclaimTicket("ada", "pi_1");
    if (!unclaimed.ok) throw new Error(unclaimed.reason);
    const reissued = unclaimed.ticket;
    expect(reissued.ticketCode).not.toBe(original);

    const stored = await recordTicket(purchase("Paid"));
    expect(stored.ticketCode).toBe(reissued.ticketCode);
    expect((await row()).ticketCode).toBe(reissued.ticketCode);
  });

  it("a replay leaves the owner alone", async () => {
    await account("ada");
    const { ticketCode: code } = await recordTicket(purchase("Paid"));
    await claimTicket("ada", code!);
    await recordTicket(purchase("Paid"));
    expect((await row()).ownerUserId).toBe("ada");
  });

  it("links a referrer that exists and ignores one that doesn't", async () => {
    await recordTicket(purchase("Paid"));
    await recordTicket(purchase("Paid", { id: "pi_2" }), {
      referredBy: "pi_1",
    });
    await recordTicket(purchase("Paid", { id: "pi_3" }), {
      referredBy: "pi_missing",
    });
    expect((await row("pi_2")).referredByPaymentId).toBe("pi_1");
    expect((await row("pi_3")).referredByPaymentId).toBeNull();
  });
});

describe("markTicketFailed", () => {
  it("flips an existing row and no-ops without one", async () => {
    await recordTicket(purchase("Pending"));
    await markTicketFailed("pi_1");
    await markTicketFailed("pi_missing");
    expect((await row()).status).toBe("failed");
    expect(await row("pi_missing")).toBeUndefined();
  });
});

describe("ticket ownership", () => {
  beforeEach(async () => {
    await account("ada");
    await account("bea");
  });

  it("a matching purchaser email alone owns nothing", async () => {
    await recordTicket(purchase("Paid", { customerEmail: "ada@example.com" }));
    expect((await row()).ownerUserId).toBeNull();
    expect(await hasClaimedTicket("ada")).toBe(false);
  });

  it("the first claim wins and the second is told it's taken", async () => {
    const { ticketCode: code } = await recordTicket(purchase("Paid"));
    expect(await claimTicket("ada", code!)).toMatchObject({ ok: true });
    expect(await claimTicket("bea", code!)).toEqual({
      ok: false,
      reason: "taken",
    });
    expect(await hasClaimedTicket("ada")).toBe(true);
  });

  it("claiming your own again says so", async () => {
    const { ticketCode: code } = await recordTicket(purchase("Paid"));
    await claimTicket("ada", code!);
    expect(await claimTicket("ada", code!)).toEqual({
      ok: false,
      reason: "yours",
    });
  });

  it("allows one admission per person", async () => {
    const first = await recordTicket(purchase("Paid"));
    const second = await recordTicket(purchase("Paid", { id: "pi_2" }));
    await claimTicket("ada", first.ticketCode!);
    expect(await claimTicket("ada", second.ticketCode!)).toEqual({
      ok: false,
      reason: "already",
    });
  });

  it.each([
    ["Pending", "unpaid"],
    ["Failed", "void"],
    ["Underpaid", "void"],
  ] as const)("won't claim a %s ticket", async (status, reason) => {
    const { ticketCode: code } = await recordTicket(purchase(status));
    expect(await claimTicket("ada", code!)).toEqual({ ok: false, reason });
  });

  it("refuses an unknown code", async () => {
    expect(await claimTicket("ada", "NOPE00")).toEqual({
      ok: false,
      reason: "unknown",
    });
  });

  it("caps failed claims per account", async () => {
    for (let i = 0; i < 25; i++) await claimTicket("ada", "NOPE00");
    expect(await claimTicket("ada", "NOPE00")).toEqual({
      ok: false,
      reason: "limited",
    });
    expect(await claimTicket("bea", "NOPE00")).toEqual({
      ok: false,
      reason: "unknown",
    });
  });

  it("unclaiming kills the old code and makes the attendee the holder", async () => {
    const { ticketCode: code } = await recordTicket(purchase("Paid"));
    await claimTicket("ada", code!);
    const unclaimed = await unclaimTicket("ada", "pi_1");
    if (!unclaimed.ok) throw new Error(unclaimed.reason);
    const { ticket } = unclaimed;
    expect(ticket).toMatchObject({ ownerUserId: null, holderUserId: "ada" });
    expect(await claimTicket("bea", code!)).toEqual({
      ok: false,
      reason: "unknown",
    });
    expect(await claimTicket("bea", ticket.ticketCode)).toMatchObject({
      ok: true,
    });
  });

  it("only the attendee can unclaim", async () => {
    const { ticketCode: code } = await recordTicket(purchase("Paid"));
    await claimTicket("ada", code!);
    expect(await unclaimTicket("bea", "pi_1")).toEqual({
      ok: false,
      reason: "notYours",
    });
    expect((await row()).ownerUserId).toBe("ada");
  });

  it("the buyer claims their own without the code, until someone else holds it", async () => {
    await recordTicket(purchase("Paid", { customerEmail: "ada@example.com" }));
    expect(await claimOwnTicket("bea", "bea@example.com", "pi_1")).toEqual({
      ok: false,
      reason: "unknown",
    });
    expect(
      await claimOwnTicket("ada", "ada@example.com", "pi_1"),
    ).toMatchObject({ ok: true });
    await unclaimTicket("ada", "pi_1");
    await db
      .update(tickets)
      .set({ holderUserId: "bea" })
      .where(eq(tickets.paymentId, "pi_1"));
    expect(await claimOwnTicket("ada", "ada@example.com", "pi_1")).toEqual({
      ok: false,
      reason: "unknown",
    });
  });
});

describe("replayed", () => {
  it("is set only when the row already had this status", async () => {
    await expect(recordTicket(purchase("Pending"))).resolves.toMatchObject({
      replayed: false,
    });
    await expect(recordTicket(purchase("Pending"))).resolves.toMatchObject({
      replayed: true,
    });
    await expect(recordTicket(purchase("Paid"))).resolves.toMatchObject({
      replayed: false,
    });
    await expect(recordTicket(purchase("Paid"))).resolves.toMatchObject({
      replayed: true,
    });
    await expect(recordTicket(purchase("Pending"))).resolves.toMatchObject({
      status: "Paid",
      replayed: true,
    });
  });
});

describe("without a database", () => {
  it("throws in production and warns elsewhere", async () => {
    const { env } = await import("@/env");
    const saved = env.DATABASE_URL;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    (env as { DATABASE_URL?: string }).DATABASE_URL = undefined;
    try {
      await expect(recordTicket(purchase("Paid"))).resolves.toMatchObject({
        ticketCode: ticketCode("pi_1"),
      });
      expect(warn).toHaveBeenCalled();
      vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "production");
      await expect(recordTicket(purchase("Paid"))).rejects.toThrow(
        "DATABASE_URL",
      );
    } finally {
      vi.unstubAllEnvs();
      (env as { DATABASE_URL?: string }).DATABASE_URL = saved;
    }
  });
});
