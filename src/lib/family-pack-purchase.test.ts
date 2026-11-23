import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
const {
  recordPurchase,
  recordTicket,
  capturePurchase,
  sendTicketConfirmationEmail,
  followUpTicketPurchase,
} = vi.hoisted(() => ({
  recordPurchase: vi.fn(),
  recordTicket: vi.fn(),
  capturePurchase: vi.fn(),
  sendTicketConfirmationEmail: vi.fn(),
  followUpTicketPurchase: vi.fn(),
}));
vi.mock("@/lib/airtable", () => ({ recordPurchase }));
vi.mock("@/lib/posthog-server", () => ({ capturePurchase }));
vi.mock("@/lib/email", () => ({ sendTicketConfirmationEmail }));
vi.mock("@/lib/ticket-followup", () => ({ followUpTicketPurchase }));
vi.mock("@/lib/error-report", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/ticket-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ticket-store")>()),
  recordTicket,
}));
import { recordFamilyPack } from "./family-pack-purchase";
import { packMetadata } from "./family-pack";
import { ticketCode } from "./ticket-code";
import { ticketFromPurchase } from "./ticket-store";
import type { PurchaseRecord } from "./airtable";

function session(count = 4) {
  return {
    id: "cs_pack",
    currency: "usd",
    amount_total: count * 37500,
    livemode: false,
    total_details: { amount_discount: 0 },
    customer_details: { name: "Buyer", email: "buyer@example.com" },
    metadata: packMetadata(
      Array.from({ length: count }, (_, i) => ({
        name: `Guest ${i}`,
        email: `guest${i}@example.com`,
      })),
    ),
    payment_intent: {
      id: "pi_pack",
      latest_charge: {
        receipt_url: "https://receipt.example",
        balance_transaction: { fee: 4381, net: count * 37500 - 4381 },
      },
    },
  } as unknown as Stripe.Checkout.Session;
}

describe("family pack fulfillment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordPurchase.mockResolvedValue({ stored: true });
    recordTicket.mockImplementation(async (p: PurchaseRecord) => ({
      ...p,
      ticketCode: ticketCode(p.id),
    }));
    sendTicketConfirmationEmail.mockResolvedValue({ sent: true });
  });
  it.each([4, 5, 6])(
    "creates %i admissions with reconciled accounting and separate codes",
    async (count) => {
      await recordFamilyPack(session(count), "Paid");
      const rows = recordPurchase.mock.calls.map(([row]) => row);
      expect(rows).toHaveLength(count);
      expect(new Set(rows.map((r) => r.ticketCode)).size).toBe(count);
      expect(rows.reduce((sum, r) => sum + Math.round(r.amount * 100), 0)).toBe(
        count * 37500,
      );
      expect(rows.reduce((sum, r) => sum + Math.round(r.fee * 100), 0)).toBe(
        4381,
      );
      expect(rows.reduce((sum, r) => sum + Math.round(r.net * 100), 0)).toBe(
        count * 37500 - 4381,
      );
      expect(sendTicketConfirmationEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "buyer@example.com",
          groupTickets: expect.any(Array),
          idempotencyKey: "family-pack/pi_pack",
        }),
      );
      expect(sendTicketConfirmationEmail).toHaveBeenCalledTimes(count + 1);
      rows.forEach((row, i) =>
        expect(sendTicketConfirmationEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            to: `guest${i}@example.com`,
            ticketCode: row.ticketCode,
            idempotencyKey: `family-pack/pi_pack/ticket/${i + 1}`,
          }),
        ),
      );
    },
  );
  it("doesn't separately email an attendee who is also the buyer", async () => {
    const s = session();
    s.customer_details!.email = "GUEST0@example.com";
    await recordFamilyPack(s, "Paid");
    expect(sendTicketConfirmationEmail).toHaveBeenCalledTimes(4);
    expect(sendTicketConfirmationEmail).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: "guest0@example.com" }),
    );
  });
  it("writes one tickets row per admission, owned by each attendee's email", async () => {
    await recordFamilyPack(session(5), "Paid");
    const rows = recordTicket.mock.calls.map(([p]) => ticketFromPurchase(p));
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((r) => r.paymentId)).size).toBe(5);
    rows.forEach((row, i) =>
      expect(row).toMatchObject({
        paymentId: `pi_pack:ticket:${i + 1}`,
        purchaserEmail: `guest${i}@example.com`,
        purchaserName: `Guest ${i}`,
        status: "paid",
        source: "stripe",
        amountCents: 37500,
        test: true,
      }),
    );
    expect(rows.map((r) => r.ticketCode)).toEqual(
      recordPurchase.mock.calls.map(([p]) => p.ticketCode),
    );
  });
  it("records every admission after the first as referred by the first", async () => {
    await recordFamilyPack(session(3), "Paid");
    expect(recordTicket.mock.calls.map(([, opts]) => opts?.referredBy)).toEqual(
      [undefined, "pi_pack:ticket:1", "pi_pack:ticket:1"],
    );
  });
  it("retains admission identities through pending, paid and replay events", async () => {
    await recordFamilyPack(session(), "Pending");
    const before = recordPurchase.mock.calls.map(([r]) => [r.id, r.ticketCode]);
    expect(sendTicketConfirmationEmail).not.toHaveBeenCalled();
    recordPurchase.mockClear();
    await recordFamilyPack(session(), "Paid");
    expect(
      recordPurchase.mock.calls.map(([r]) => [r.id, r.ticketCode]),
    ).toEqual(before);
    recordPurchase.mockClear();
    await recordFamilyPack(session(), "Paid");
    expect(
      recordPurchase.mock.calls.map(([r]) => [r.id, r.ticketCode]),
    ).toEqual(before);
  });
  it("does not fulfill an undercharged or additionally discounted order", async () => {
    await expect(
      recordFamilyPack({ ...session(), amount_total: 1 }, "Paid"),
    ).rejects.toThrow();
    await expect(
      recordFamilyPack(
        {
          ...session(),
          total_details: { amount_discount: 50 },
        } as Stripe.Checkout.Session,
        "Paid",
      ),
    ).rejects.toThrow();
    expect(recordPurchase).not.toHaveBeenCalled();
  });
  it("writes every ticket before the mirror, and delivers despite its failure", async () => {
    recordPurchase.mockRejectedValue(new Error("Airtable 429"));
    const { mirrorError } = await recordFamilyPack(session(4), "Paid");
    expect(mirrorError).toEqual(new Error("Airtable 429"));
    expect(recordTicket).toHaveBeenCalledTimes(4);
    expect(recordPurchase).toHaveBeenCalledTimes(1);
    expect(capturePurchase).toHaveBeenCalledTimes(4);
    expect(sendTicketConfirmationEmail).toHaveBeenCalledTimes(5);
    expect(recordTicket.mock.invocationCallOrder[3]).toBeLessThan(
      recordPurchase.mock.invocationCallOrder[0],
    );
  });
  describe("a retry", () => {
    const replaying = (replayed: (id: string) => boolean) =>
      recordTicket.mockImplementation(async (p: PurchaseRecord) => ({
        ...p,
        ticketCode: ticketCode(p.id),
        replayed: replayed(p.id),
      }));

    it("skips the follow-ups when only Airtable is holding it up", async () => {
      replaying(() => true);
      recordPurchase.mockRejectedValue(new Error("Airtable 429"));
      const result = await recordFamilyPack(session(4), "Paid");
      expect(result).toMatchObject({ replayed: true });
      expect(followUpTicketPurchase).not.toHaveBeenCalled();
      expect(sendTicketConfirmationEmail).toHaveBeenCalledTimes(5);
    });

    it("follows up when the mirror lands, since an email may have thrown before", async () => {
      replaying(() => true);
      await recordFamilyPack(session(4), "Paid");
      expect(followUpTicketPurchase).toHaveBeenCalledTimes(4);
    });

    it("follows up when an earlier delivery stopped partway through the rows", async () => {
      replaying((id) => !id.endsWith(":4"));
      recordPurchase.mockRejectedValue(new Error("Airtable 429"));
      const result = await recordFamilyPack(session(4), "Paid");
      expect(result).toMatchObject({ replayed: false });
      expect(followUpTicketPurchase).toHaveBeenCalledTimes(4);
    });
  });
  it("reports an unconfigured mirror the same way", async () => {
    recordPurchase.mockResolvedValue({ stored: false });
    const { mirrorError } = await recordFamilyPack(session(), "Paid");
    expect(mirrorError).toBeInstanceOf(Error);
    expect(recordTicket).toHaveBeenCalledTimes(4);
  });
  it("returns no mirror error when it all lands", async () => {
    expect((await recordFamilyPack(session(), "Paid")).mirrorError).toBe(
      undefined,
    );
  });
  it("propagates ticket and email failures so Stripe retries can recover", async () => {
    recordTicket.mockRejectedValueOnce(new Error("Neon down"));
    await expect(recordFamilyPack(session(), "Paid")).rejects.toThrow(
      "Neon down",
    );
    expect(recordPurchase).not.toHaveBeenCalled();
    expect(sendTicketConfirmationEmail).not.toHaveBeenCalled();
    sendTicketConfirmationEmail.mockRejectedValue(new Error("mail down"));
    await expect(recordFamilyPack(session(), "Paid")).rejects.toThrow(
      "mail down",
    );
  });
  it("emails and mirrors the codes the tickets have now", async () => {
    recordTicket.mockImplementation(async (p: PurchaseRecord) => ({
      ...p,
      ticketCode: p.id.endsWith(":2") ? "REISSU" : ticketCode(p.id),
    }));
    await recordFamilyPack(session(4), "Paid");
    expect(recordPurchase.mock.calls[1][0].ticketCode).toBe("REISSU");
    const [buyer] = sendTicketConfirmationEmail.mock.calls[0];
    expect(buyer.groupTickets[1].code).toBe("REISSU");
    expect(sendTicketConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "guest1@example.com",
        ticketCode: "REISSU",
      }),
    );
  });
  it("mirrors the stored status, not a Pending the rows refused", async () => {
    recordTicket.mockImplementation(async (p: PurchaseRecord) => ({
      ...p,
      status: "Paid",
      ticketCode: ticketCode(p.id),
    }));
    await recordFamilyPack(session(), "Pending");
    expect(recordPurchase.mock.calls[0][0].status).toBe("Paid");
    expect(sendTicketConfirmationEmail).not.toHaveBeenCalled();
  });
});
