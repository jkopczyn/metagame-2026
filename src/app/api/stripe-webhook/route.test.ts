import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PurchaseRecord } from "@/lib/airtable";
import { FAMILY_PACK } from "@/lib/family-pack";

const mocks = vi.hoisted(() => ({
  env: { STRIPE_WEBHOOK_SECRET: "whsec_test" as string | undefined },
  constructEventAsync: vi.fn(),
  retrieve: vi.fn(),
  getStripe: vi.fn(),
  recordPurchase: vi.fn(),
  recordDiscountCode: vi.fn(),
  recordSignup: vi.fn(),
  signupCreatedAt: vi.fn(),
  recordTicket: vi.fn(),
  capturePurchase: vi.fn(),
  sendTicketConfirmationEmail: vi.fn(),
  followUpTicketPurchase: vi.fn(),
  reportError: vi.fn(),
  reportErrorOnce: vi.fn(),
  recordFamilyPack: vi.fn(),
}));

vi.mock("@/env", () => ({ env: mocks.env }));
vi.mock("@/lib/stripe", () => ({ getStripe: mocks.getStripe }));
vi.mock("@/lib/airtable", () => ({
  recordPurchase: mocks.recordPurchase,
  recordDiscountCode: mocks.recordDiscountCode,
  recordSignup: mocks.recordSignup,
  signupCreatedAt: mocks.signupCreatedAt,
}));
vi.mock("@/lib/ticket-store", () => ({ recordTicket: mocks.recordTicket }));
vi.mock("@/lib/posthog-server", () => ({
  capturePurchase: mocks.capturePurchase,
}));
vi.mock("@/lib/email", () => ({
  sendTicketConfirmationEmail: mocks.sendTicketConfirmationEmail,
}));
vi.mock("@/lib/ticket-followup", () => ({
  followUpTicketPurchase: mocks.followUpTicketPurchase,
}));
vi.mock("@/lib/error-report", () => ({
  reportError: mocks.reportError,
  reportErrorOnce: mocks.reportErrorOnce,
}));
vi.mock("@/lib/family-pack-purchase", () => ({
  recordFamilyPack: mocks.recordFamilyPack,
}));

import { POST } from "./route";

function delivery(signature: string | null = "sig") {
  return POST(
    new Request("https://metagame.games/api/stripe-webhook", {
      method: "POST",
      headers: signature ? { "stripe-signature": signature } : {},
      body: "{}",
    }),
  );
}

/** An event whose payload is `snapshot`; what retrieve returns is set separately. */
function event(type: string, snapshot: Record<string, unknown> = {}) {
  mocks.constructEventAsync.mockResolvedValue({
    id: "evt_1",
    type,
    livemode: true,
    data: { object: { id: "cs_1", ...snapshot } },
  });
}

function current(overrides: Record<string, unknown> = {}) {
  mocks.retrieve.mockResolvedValue({
    id: "cs_1",
    payment_status: "paid",
    amount_total: 32500,
    amount_subtotal: 32500,
    customer_details: { email: "ada@example.com", name: "Ada" },
    metadata: { tier: "standard" },
    payment_intent: { id: "pi_1", latest_charge: null },
    ...overrides,
  });
}

const callOrder = (fn: { mock: { invocationCallOrder: number[] } }) =>
  fn.mock.invocationCallOrder[0];
const mirrored = (): PurchaseRecord => mocks.recordPurchase.mock.calls[0][0];
const recorded = (): PurchaseRecord => mocks.recordTicket.mock.calls[0][0];
const emailed = () => mocks.sendTicketConfirmationEmail.mock.calls[0][0];

describe("stripe webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    mocks.getStripe.mockReturnValue({
      webhooks: { constructEventAsync: mocks.constructEventAsync },
      checkout: { sessions: { retrieve: mocks.retrieve } },
    });
    mocks.recordPurchase.mockResolvedValue({ stored: true });
    mocks.recordTicket.mockImplementation(async (p: PurchaseRecord) => ({
      ...p,
      ticketCode: "CODE01",
    }));
    mocks.signupCreatedAt.mockResolvedValue(new Date());
    mocks.sendTicketConfirmationEmail.mockResolvedValue({ sent: true });
    current();
  });
  afterEach(() => vi.unstubAllEnvs());

  describe("before processing", () => {
    it("rejects a missing or bad signature", async () => {
      expect((await delivery(null)).status).toBe(400);
      mocks.constructEventAsync.mockRejectedValue(new Error("no"));
      expect((await delivery()).status).toBe(400);
      expect(mocks.recordTicket).not.toHaveBeenCalled();
    });

    it("no-ops without config outside production", async () => {
      mocks.env.STRIPE_WEBHOOK_SECRET = undefined;
      const res = await delivery();
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ configured: false });
      expect(mocks.reportErrorOnce).not.toHaveBeenCalled();
    });

    it.each([
      ["webhook secret", () => (mocks.env.STRIPE_WEBHOOK_SECRET = undefined)],
      ["Stripe key", () => mocks.getStripe.mockReturnValue(null)],
    ])(
      "asks for a retry and alerts without the %s in production",
      async (_, unset) => {
        vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "production");
        unset();
        expect((await delivery()).status).toBe(500);
        expect(mocks.reportErrorOnce).toHaveBeenCalledTimes(1);
        expect(mocks.recordTicket).not.toHaveBeenCalled();
      },
    );

    it("ignores events it doesn't handle", async () => {
      event("customer.created");
      expect((await delivery()).status).toBe(200);
      expect(mocks.retrieve).not.toHaveBeenCalled();
    });
  });

  describe("status comes from the current session", () => {
    it("settles a delayed completed event whose snapshot is unpaid", async () => {
      event("checkout.session.completed", { payment_status: "unpaid" });
      expect((await delivery()).status).toBe(200);
      expect(recorded().status).toBe("Paid");
      expect(mirrored().status).toBe("Paid");
      expect(mocks.sendTicketConfirmationEmail).toHaveBeenCalledTimes(1);
    });

    it("keeps a paid session paid when a delayed failure arrives", async () => {
      event("checkout.session.async_payment_failed");
      await delivery();
      expect(recorded().status).toBe("Paid");
    });

    it("records an unsettled ACH checkout as Pending, with no email", async () => {
      event("checkout.session.completed", { payment_status: "unpaid" });
      current({ payment_status: "unpaid" });
      expect((await delivery()).status).toBe(200);
      expect(recorded().status).toBe("Pending");
      expect(mocks.sendTicketConfirmationEmail).not.toHaveBeenCalled();
      expect(mocks.followUpTicketPurchase).not.toHaveBeenCalled();
    });

    it("records a bounced ACH payment as Failed, with no email", async () => {
      event("checkout.session.async_payment_failed");
      current({ payment_status: "unpaid" });
      await delivery();
      expect(recorded().status).toBe("Failed");
      expect(mocks.sendTicketConfirmationEmail).not.toHaveBeenCalled();
    });

    it("treats a checkout with nothing owed as Paid", async () => {
      event("checkout.session.completed");
      current({ payment_status: "no_payment_required", payment_intent: null });
      await delivery();
      expect(recorded()).toMatchObject({ status: "Paid", id: "cs_1" });
    });

    it("mirrors the stored status, not a Pending the row refused", async () => {
      event("checkout.session.completed");
      current({ payment_status: "unpaid" });
      mocks.recordTicket.mockImplementation(async (p: PurchaseRecord) => ({
        ...p,
        status: "Paid",
        ticketCode: "CODE01",
      }));
      await delivery();
      expect(recorded().status).toBe("Pending");
      expect(mirrored().status).toBe("Paid");
      expect(mocks.sendTicketConfirmationEmail).not.toHaveBeenCalled();
    });
  });

  describe("a paid purchase", () => {
    beforeEach(() => event("checkout.session.completed"));

    it("writes Postgres, then Airtable, then emails", async () => {
      expect((await delivery()).status).toBe(200);
      expect(callOrder(mocks.recordTicket)).toBeLessThan(
        callOrder(mocks.recordPurchase),
      );
      expect(callOrder(mocks.recordPurchase)).toBeLessThan(
        callOrder(mocks.sendTicketConfirmationEmail),
      );
      expect(mocks.followUpTicketPurchase).toHaveBeenCalledTimes(1);
    });

    it("gives the confirmation a key stable across deliveries", async () => {
      await delivery();
      await delivery();
      const keys = mocks.sendTicketConfirmationEmail.mock.calls.map(
        ([email]) => email.idempotencyKey,
      );
      expect(keys).toEqual(["ticket/pi_1", "ticket/pi_1"]);
    });

    it("emails and mirrors the code the ticket has now", async () => {
      mocks.recordTicket.mockImplementation(async (p: PurchaseRecord) => ({
        ...p,
        ticketCode: "REISSU",
      }));
      await delivery();
      expect(emailed().ticketCode).toBe("REISSU");
      expect(mirrored().ticketCode).toBe("REISSU");
    });

    it("still delivers the ticket and email when Airtable fails, then retries", async () => {
      mocks.recordPurchase.mockRejectedValue(new Error("Airtable 429"));
      expect((await delivery()).status).toBe(500);
      expect(mocks.recordTicket).toHaveBeenCalledTimes(1);
      expect(emailed().ticketCode).toBe("CODE01");
      expect(mocks.followUpTicketPurchase).toHaveBeenCalledTimes(1);
      expect(mocks.reportError).toHaveBeenCalledTimes(1);
      expect(mocks.reportError.mock.calls[0][0]).toMatchObject({
        mention: false,
      });
    });

    it("doesn't repeat the follow-up or alert on a retry stuck on Airtable", async () => {
      mocks.recordPurchase.mockRejectedValue(new Error("Airtable 429"));
      mocks.recordTicket.mockImplementation(async (p: PurchaseRecord) => ({
        ...p,
        ticketCode: "CODE01",
        replayed: true,
      }));
      expect((await delivery()).status).toBe(500);
      expect(emailed().idempotencyKey).toBe("ticket/pi_1");
      expect(mocks.followUpTicketPurchase).not.toHaveBeenCalled();
      expect(mocks.signupCreatedAt).not.toHaveBeenCalled();
      expect(mocks.reportError).not.toHaveBeenCalled();
    });

    it("follows up as usual on a replay whose mirror lands", async () => {
      mocks.recordTicket.mockImplementation(async (p: PurchaseRecord) => ({
        ...p,
        ticketCode: "CODE01",
        replayed: true,
      }));
      expect((await delivery()).status).toBe(200);
      expect(mocks.followUpTicketPurchase).toHaveBeenCalledTimes(1);
    });

    it("retries in production when Airtable isn't configured", async () => {
      vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "production");
      mocks.recordPurchase.mockResolvedValue({
        stored: false,
        reason: "airtable-not-configured",
      });
      expect((await delivery()).status).toBe(500);
      expect(emailed().ticketCode).toBe("CODE01");
      expect(mocks.reportError).toHaveBeenCalledTimes(1);
    });

    it("acknowledges an unconfigured Airtable outside production", async () => {
      mocks.recordPurchase.mockResolvedValue({
        stored: false,
        reason: "airtable-not-configured",
      });
      expect((await delivery()).status).toBe(200);
      expect(mocks.reportError).not.toHaveBeenCalled();
    });

    it("sends nothing when Postgres fails, so the retry does it all", async () => {
      mocks.recordTicket.mockRejectedValue(new Error("Neon down"));
      expect((await delivery()).status).toBe(500);
      expect(mocks.recordPurchase).not.toHaveBeenCalled();
      expect(mocks.sendTicketConfirmationEmail).not.toHaveBeenCalled();
      expect(mocks.reportError).toHaveBeenCalledTimes(1);
    });

    it("acknowledges a failed email, since a retry can't be counted on to help", async () => {
      mocks.sendTicketConfirmationEmail.mockRejectedValue(new Error("Resend"));
      expect((await delivery()).status).toBe(200);
      expect(mocks.reportError).toHaveBeenCalledTimes(1);
      expect(mocks.followUpTicketPurchase).toHaveBeenCalledTimes(1);
    });

    it("adds a new buyer to the mailing list with an opt-out link", async () => {
      mocks.signupCreatedAt.mockResolvedValue(null);
      await delivery();
      expect(mocks.recordSignup).toHaveBeenCalledTimes(1);
      expect(emailed().mailingListOptOutUrl).toContain("session_id=cs_1");
    });

    it("flags a sandbox purchase as Test", async () => {
      mocks.constructEventAsync.mockResolvedValue({
        id: "evt_1",
        type: "checkout.session.completed",
        livemode: false,
        data: { object: { id: "cs_1" } },
      });
      await delivery();
      expect(recorded().test).toBe(true);
    });
  });

  describe("a family pack", () => {
    beforeEach(() => {
      event("checkout.session.completed", { payment_status: "unpaid" });
      current({ metadata: { tier: FAMILY_PACK.id } });
    });

    it("fulfills from the current session's status", async () => {
      mocks.recordFamilyPack.mockResolvedValue({});
      expect((await delivery()).status).toBe(200);
      expect(mocks.recordFamilyPack.mock.calls[0][1]).toBe("Paid");
      expect(mocks.recordTicket).not.toHaveBeenCalled();
    });

    it("retries quietly after an Airtable failure", async () => {
      mocks.recordFamilyPack.mockResolvedValue({
        mirrorError: new Error("Airtable 429"),
      });
      expect((await delivery()).status).toBe(500);
      expect(mocks.reportError).toHaveBeenCalledTimes(1);
      expect(mocks.reportError.mock.calls[0][0]).toMatchObject({
        mention: false,
      });
    });

    it("stays quiet on a retry the pack says is stuck on Airtable", async () => {
      mocks.recordFamilyPack.mockResolvedValue({
        mirrorError: new Error("Airtable 429"),
        replayed: true,
      });
      expect((await delivery()).status).toBe(500);
      expect(mocks.reportError).not.toHaveBeenCalled();
    });

    it("retries with one alert when fulfillment fails", async () => {
      mocks.recordFamilyPack.mockRejectedValue(new Error("Neon down"));
      expect((await delivery()).status).toBe(500);
      expect(mocks.reportError).toHaveBeenCalledTimes(1);
      expect(mocks.reportError.mock.calls[0][0].mention).toBeUndefined();
    });
  });

  it("asks for a retry when the session can't be retrieved", async () => {
    event("checkout.session.completed");
    mocks.retrieve.mockRejectedValue(new Error("Stripe timeout"));
    expect((await delivery()).status).toBe(500);
    expect(mocks.recordTicket).not.toHaveBeenCalled();
  });

  it("asks for a retry when a promotion code can't be mirrored", async () => {
    event("promotion_code.created", { code: "FRIEND", active: true });
    mocks.recordDiscountCode.mockRejectedValue(new Error("Airtable 500"));
    expect((await delivery()).status).toBe(500);
  });
});
