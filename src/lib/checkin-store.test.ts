import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";

const client = new PGlite();
const db = drizzle({ client, schema, casing: "snake_case" });
vi.mock("@/db", () => ({ getDb: () => db, schema }));

const { CHECKIN_SEARCH_LIMIT, searchCheckinTickets } =
  await import("./checkin-store");

async function seed(
  paymentId: string,
  {
    name,
    code = paymentId.toUpperCase().slice(-6).padStart(6, "A"),
    badge = null,
  }: { name: string; code?: string; badge?: number | null },
) {
  await client.query(
    `insert into tickets (payment_id, ticket_code, source, status, purchaser_name, badge_code)
     values ($1, $2, 'stripe', 'paid', $3, $4)`,
    [paymentId, code, name, badge],
  );
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
  for (let i = 0; i < CHECKIN_SEARCH_LIMIT + 5; i++) {
    await seed(`pi_42_${i}`, { name: `Person 42 number ${i}` });
  }
  await seed("pi_badge", { name: "Wears badge", badge: 42 });
  await seed("pi_smiley", { name: "Brian Smiley" });
  await seed("pi_code", { name: "Code holder", code: "SM11EY" });
});

afterAll(() => client.close());

const ids = (rows: { paymentId: string }[]) => rows.map((r) => r.paymentId);

describe("searchCheckinTickets", () => {
  it("looks digits up as a badge number only", async () => {
    expect(ids(await searchCheckinTickets("42"))).toEqual(["pi_badge"]);
    expect(ids(await searchCheckinTickets("0042"))).toEqual(["pi_badge"]);
  });

  it("still finds a six-letter name that reads as a ticket code, code first", async () => {
    expect(ids(await searchCheckinTickets("Smiley"))).toEqual([
      "pi_code",
      "pi_smiley",
    ]);
  });

  it("escapes LIKE wildcards in the text", async () => {
    expect(await searchCheckinTickets("%42%")).toEqual([]);
  });
});
