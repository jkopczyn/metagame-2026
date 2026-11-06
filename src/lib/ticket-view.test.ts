import { describe, expect, it } from "vitest";
import type { TicketRow } from "./ticket-store";
import { ticketView } from "./ticket-view";

const row = (over: Partial<TicketRow> = {}): TicketRow => ({
  paymentId: "pi_1",
  ticketCode: "A2C4EF",
  source: "stripe",
  status: "paid",
  test: false,
  tier: "Standard",
  amountCents: 32500,
  couponCode: null,
  purchaserEmail: "ada@example.com",
  purchaserName: "Ada",
  purchaserDiscord: null,
  ownerUserId: null,
  claimedAt: null,
  holderUserId: null,
  referralCode: null,
  referredByPaymentId: null,
  badgeCode: null,
  claimedBy: null,
  checkedInAt: null,
  checkedInBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

const ada = ["u1", "ada@example.com"] as const;

describe("ticketView", () => {
  it("shows the buyer an unclaimed ticket's code", () => {
    expect(ticketView(row(), ...ada)).toEqual({
      id: "pi_1",
      tier: "Standard",
      status: "paid",
      test: false,
      mine: false,
      claimed: false,
      code: "A2C-4EF",
      transferred: false,
      referralCode: null,
      referredBy: null,
      badgeCode: null,
      checkedIn: false,
    });
  });

  it("shows the padded badge number to the owner only", () => {
    const r = row({ badgeCode: 42, ownerUserId: "u2" });
    expect(ticketView(r, "u2", "bob@example.com").badgeCode).toBe("0042");
    expect(ticketView(r, ...ada).badgeCode).toBeNull();
    expect(ticketView(row({ badgeCode: 42 }), ...ada).badgeCode).toBeNull();
  });

  it("shows the referral code to the holder and the owner, nobody else", () => {
    const r = row({ referralCode: "ABCDEFGH", referredByPaymentId: "pi_0" });
    expect(ticketView(r, ...ada)).toMatchObject({
      referralCode: "ABCD-EFGH",
    });
    expect(
      ticketView({ ...r, ownerUserId: "u2" }, "u2", "bob@example.com"),
    ).toMatchObject({ referralCode: "ABCD-EFGH" });
    expect(
      ticketView({ ...r, holderUserId: "u2" }, ...ada).referralCode,
    ).toBeNull();
  });

  it("hides a claimed ticket's code, even from its holder", () => {
    const v = ticketView(row({ ownerUserId: "u2" }), ...ada);
    expect(v).toMatchObject({ claimed: true, mine: false, code: null });
    expect(v.transferred).toBe(false);
    expect(ticketView(row({ ownerUserId: "u1" }), ...ada)).toMatchObject({
      mine: true,
      code: null,
    });
  });

  it("shows the code to a holder who didn't buy it", () => {
    expect(
      ticketView(row({ holderUserId: "u2" }), "u2", "bob@example.com"),
    ).toMatchObject({ code: "A2C-4EF", transferred: false });
  });

  it("marks a ticket the buyer no longer holds as transferred, without a code", () => {
    expect(ticketView(row({ holderUserId: "u2" }), ...ada)).toMatchObject({
      code: null,
      transferred: true,
      mine: false,
    });
  });

  it("keeps the code with a buyer who unclaimed their own ticket", () => {
    expect(ticketView(row({ holderUserId: "u1" }), ...ada)).toMatchObject({
      code: "A2C-4EF",
      transferred: false,
    });
  });
});
