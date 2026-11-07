import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
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
import { ticketCode } from "./ticket-code";

const client = new PGlite();
const db = drizzle({ client, schema, casing: "snake_case" });
vi.mock("@/db", () => ({ getDb: () => db, schema }));
vi.mock("@/lib/airtable", () => ({
  updatePurchaseTicketCode: vi.fn(async () => {}),
}));
vi.mock("@/lib/email", () => ({ sendAdminErrorEmail: vi.fn(async () => {}) }));

const {
  assignBadgeCode,
  badgeCodesFor,
  checkInTicket,
  claimOwnTicket,
  claimTicket,
  claimTicketFor,
  normalizeTicketCode,
  ticketFromPurchase,
  unclaimTicket,
  undoCheckIn,
} = await import("./ticket-store");

const stripe = {
  id: "pi_123",
  status: "Paid" as const,
  test: false,
  paymentMethod: "stripe" as const,
  customerName: "Ada Lovelace",
  customerEmail: " Ada@Example.com ",
  amount: 325,
  ticketType: "Standard",
  ticketCode: ticketCode("pi_123"),
};

describe("ticketFromPurchase", () => {
  it("maps a Stripe purchase", () => {
    expect(ticketFromPurchase(stripe)).toEqual({
      paymentId: "pi_123",
      ticketCode: ticketCode("pi_123"),
      source: "stripe",
      status: "paid",
      test: false,
      tier: "Standard",
      amountCents: 32500,
      couponCode: null,
      purchaserEmail: "ada@example.com",
      purchaserName: "Ada Lovelace",
      purchaserDiscord: null,
    });
    expect(
      ticketFromPurchase({ ...stripe, discordHandle: " @ada_l" })
        .purchaserDiscord,
    ).toBe("ada_l");
    expect(
      ticketFromPurchase({ ...stripe, couponCode: " earlyBird " }).couponCode,
    ).toBe("EARLYBIRD");
  });

  it("prefers the preferred name and derives a missing code", () => {
    const row = ticketFromPurchase({
      ...stripe,
      ticketCode: undefined,
      preferredName: "Ada",
    });
    expect(row.purchaserName).toBe("Ada");
    expect(row.ticketCode).toBe(ticketCode("pi_123"));
  });

  it("maps a BTC charge with no email to opennode and null", () => {
    const row = ticketFromPurchase({
      id: "abc-def",
      status: "Pending",
      test: true,
      paymentMethod: "btc",
      amount: 0.5,
    });
    expect(row).toMatchObject({
      source: "opennode",
      status: "pending",
      test: true,
      tier: null,
      amountCents: 50,
      purchaserEmail: null,
      purchaserName: null,
    });
  });
});

describe("normalizeTicketCode", () => {
  it("accepts the display form and common misreads", () => {
    expect(normalizeTicketCode(" a2c-4ef ")).toBe("A2C4EF");
    expect(normalizeTicketCode("i1l-o0u")).toBe("11100V");
  });
});

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
  await client.exec(`
    insert into "user" (id, name, email)
    values ('ada', 'Ada', 'ada@example.com'),
           ('bob', 'Bob', 'bob@example.com'),
           ('desk', 'Desk', 'desk@example.com')`);
});

afterAll(() => client.close());

beforeEach(async () => {
  await client.exec("delete from tickets; delete from verification");
});

/** A paid ticket, unclaimed unless `owner` is given. */
async function seed(
  paymentId: string,
  {
    owner = null,
    status = "paid",
  }: { owner?: string | null; status?: "paid" | "pending" | "failed" } = {},
) {
  await client.query(
    `insert into tickets (payment_id, ticket_code, source, status, owner_user_id, claimed_at)
     values ($1, $2, 'stripe', $3, $4::text, case when $4::text is null then null else now() end)`,
    [paymentId, ticketCode(paymentId), status, owner],
  );
}

const fetchRow = async (paymentId: string) => {
  const { rows } = await client.query<{
    owner_user_id: string | null;
    checked_in_at: Date | null;
    checked_in_by: string | null;
    claimed_by: string | null;
    badge_code: number | null;
    ticket_code: string;
  }>("select * from tickets where payment_id = $1", [paymentId]);
  return rows[0];
};

describe("claimTicketFor", () => {
  it("claims a specific ticket for the attendee", async () => {
    await seed("pi_1");
    const result = await claimTicketFor("desk", "pi_1", "ada");
    expect(result.ok).toBe(true);
    const row = await fetchRow("pi_1");
    expect(row.owner_user_id).toBe("ada");
    expect(row.claimed_by).toBe("desk");
  });

  it("keeps the claim invariants", async () => {
    await seed("pi_1", { owner: "bob" });
    await seed("pi_2");
    await seed("pi_3", { status: "pending" });
    expect(await claimTicketFor("desk", "pi_1", "ada")).toEqual({
      ok: false,
      reason: "taken",
    });
    expect(await claimTicketFor("desk", "pi_1", "bob")).toEqual({
      ok: false,
      reason: "yours",
    });
    expect(await claimTicketFor("desk", "pi_2", "bob")).toEqual({
      ok: false,
      reason: "already",
    });
    expect(await claimTicketFor("desk", "pi_3", "ada")).toEqual({
      ok: false,
      reason: "unpaid",
    });
    expect(await claimTicketFor("desk", "pi_nope", "ada")).toEqual({
      ok: false,
      reason: "unknown",
    });
  });

  it("won't hand out a checked-in ticket whose owner account is gone", async () => {
    await seed("pi_1", { owner: "bob" });
    await checkInTicket("desk", "pi_1");
    await client.exec(
      "update tickets set owner_user_id = null where payment_id = 'pi_1'",
    );
    expect(await claimTicketFor("desk", "pi_1", "ada")).toEqual({
      ok: false,
      reason: "checkedIn",
    });
    expect(await claimTicket("ada", ticketCode("pi_1"))).toEqual({
      ok: false,
      reason: "checkedIn",
    });
    expect((await fetchRow("pi_1")).owner_user_id).toBeNull();
  });

  it("ignores the per-account failure throttle", async () => {
    await client.exec(`
      insert into verification (id, identifier, value, expires_at)
      select 'f' || n, 'claim-failed:ada', 'x', now() + interval '1 hour'
      from generate_series(1, 25) n`);
    await seed("pi_1");
    expect(await claimTicket("ada", ticketCode("pi_1"))).toEqual({
      ok: false,
      reason: "limited",
    });
    expect((await claimTicketFor("desk", "pi_1", "ada")).ok).toBe(true);
  });
});

describe("claimTicket and claimOwnTicket", () => {
  it("still claim by code and by holding", async () => {
    await seed("pi_1");
    await seed("pi_2");
    await client.query(
      "update tickets set purchaser_email = 'bob@example.com' where payment_id = 'pi_2'",
    );
    expect((await claimTicket("ada", ticketCode("pi_1"))).ok).toBe(true);
    expect((await fetchRow("pi_1")).claimed_by).toBeNull();
    expect((await claimOwnTicket("bob", "bob@example.com", "pi_2")).ok).toBe(
      true,
    );
    expect(await claimOwnTicket("ada", "ada@example.com", "pi_2")).toEqual({
      ok: false,
      reason: "unknown",
    });
  });
});

describe("checkInTicket", () => {
  it("records who checked a claimed ticket in, once", async () => {
    await seed("pi_1", { owner: "ada" });
    const first = await checkInTicket("desk", "pi_1");
    expect(first.ok).toBe(true);
    const row = await fetchRow("pi_1");
    expect(row.checked_in_by).toBe("desk");
    expect(row.checked_in_at).toBeInstanceOf(Date);

    const again = await checkInTicket("bob", "pi_1");
    expect(again).toMatchObject({ ok: false, reason: "already" });
    if (again.ok || again.reason !== "already") throw new Error("unreachable");
    expect(again.ticket.checkedInBy).toBe("desk");
    expect((await fetchRow("pi_1")).checked_in_by).toBe("desk");
  });

  it("refuses unclaimed, unpaid and unknown tickets", async () => {
    await seed("pi_1");
    await seed("pi_2", { owner: "ada", status: "pending" });
    await seed("pi_3", { owner: "bob", status: "failed" });
    expect(await checkInTicket("desk", "pi_1")).toEqual({
      ok: false,
      reason: "unclaimed",
    });
    expect(await checkInTicket("desk", "pi_2")).toEqual({
      ok: false,
      reason: "unpaid",
    });
    expect(await checkInTicket("desk", "pi_3")).toEqual({
      ok: false,
      reason: "unpaid",
    });
    expect(await checkInTicket("desk", "pi_nope")).toEqual({
      ok: false,
      reason: "unknown",
    });
  });

  it("lets exactly one of two simultaneous check-ins win", async () => {
    await seed("pi_1", { owner: "ada" });
    const results = await Promise.all([
      checkInTicket("desk", "pi_1"),
      checkInTicket("bob", "pi_1"),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "already")).toHaveLength(
      1,
    );
  });
});

describe("undoCheckIn", () => {
  it("clears both fields and reports a ticket that wasn't checked in", async () => {
    await seed("pi_1", { owner: "ada" });
    expect(await undoCheckIn("pi_1")).toBeNull();
    await checkInTicket("desk", "pi_1");
    const undone = await undoCheckIn("pi_1");
    expect(undone?.checkedInAt).toBeNull();
    expect(undone?.checkedInBy).toBeNull();
    expect((await fetchRow("pi_1")).checked_in_at).toBeNull();
  });
});

describe("unclaimTicket", () => {
  it("is refused once the ticket is checked in", async () => {
    await seed("pi_1", { owner: "ada" });
    await checkInTicket("desk", "pi_1");
    expect(await unclaimTicket("ada", "pi_1")).toEqual({
      ok: false,
      reason: "checkedIn",
    });
    expect(await unclaimTicket("bob", "pi_1")).toEqual({
      ok: false,
      reason: "notYours",
    });
    expect((await fetchRow("pi_1")).owner_user_id).toBe("ada");

    await undoCheckIn("pi_1");
    await assignBadgeCode("pi_1", 42);
    const released = await unclaimTicket("ada", "pi_1");
    if (!released.ok) throw new Error("unreachable");
    expect(released.ticket.ownerUserId).toBeNull();
    expect(released.ticket.holderUserId).toBe("ada");
    expect(released.ticket.badgeCode).toBeNull();
    expect(released.ticket.ticketCode).not.toBe(ticketCode("pi_1"));
  });

  it("tells a stranger and an unclaimed ticket apart from a checked-in one", async () => {
    await seed("pi_1");
    expect(await unclaimTicket("ada", "pi_1")).toEqual({
      ok: false,
      reason: "notYours",
    });
    expect(await unclaimTicket("ada", "pi_nope")).toEqual({
      ok: false,
      reason: "notYours",
    });
  });
});

describe("badgeCodesFor", () => {
  it("maps each account to the badge on its claimed paid ticket", async () => {
    await seed("pi_1", { owner: "ada" });
    await seed("pi_2", { owner: "bob" });
    await seed("pi_3", { owner: "desk", status: "pending" });
    await assignBadgeCode("pi_1", 42);
    await assignBadgeCode("pi_3", 9);
    expect(await badgeCodesFor(["ada", "bob", "desk", "nobody"])).toEqual(
      new Map([["ada", 42]]),
    );
    expect(await badgeCodesFor([])).toEqual(new Map());
  });
});

describe("assignBadgeCode", () => {
  it("sets, replaces and clears a code, checked in or not", async () => {
    await seed("pi_1", { owner: "ada" });
    expect((await assignBadgeCode("pi_1", 42)).ok).toBe(true);
    expect((await fetchRow("pi_1")).badge_code).toBe(42);
    await checkInTicket("desk", "pi_1");
    expect((await assignBadgeCode("pi_1", 7)).ok).toBe(true);
    expect((await fetchRow("pi_1")).badge_code).toBe(7);
    expect((await assignBadgeCode("pi_1", null)).ok).toBe(true);
    expect((await fetchRow("pi_1")).badge_code).toBeNull();
  });

  it("rejects out-of-range codes before the database sees them", async () => {
    await seed("pi_1");
    for (const code of [-1, 10000, 1.5, NaN]) {
      expect(await assignBadgeCode("pi_1", code)).toEqual({
        ok: false,
        reason: "invalid",
      });
    }
    expect(await assignBadgeCode("pi_1", 0)).toMatchObject({ ok: true });
    expect(await assignBadgeCode("pi_1", 9999)).toMatchObject({ ok: true });
  });

  it("refuses a code another ticket already wears", async () => {
    await seed("pi_1");
    await seed("pi_2");
    await assignBadgeCode("pi_1", 42);
    expect(await assignBadgeCode("pi_2", 42)).toEqual({
      ok: false,
      reason: "taken",
    });
    expect((await fetchRow("pi_2")).badge_code).toBeNull();
    expect(await assignBadgeCode("pi_nope", 1)).toEqual({
      ok: false,
      reason: "unknown",
    });
  });
});
