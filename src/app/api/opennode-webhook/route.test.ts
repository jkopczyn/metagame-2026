import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PurchaseRecord } from "@/lib/airtable";

const mocks = vi.hoisted(() => ({
  getCharge: vi.fn(),
  recordPurchase: vi.fn(),
  markPurchaseFailedIfExists: vi.fn(),
  recordSignup: vi.fn(),
  signupCreatedAt: vi.fn(),
  recordTicket: vi.fn(),
  markTicketFailed: vi.fn(),
  capturePurchase: vi.fn(),
  sendTicketConfirmationEmail: vi.fn(),
  followUpTicketPurchase: vi.fn(),
  reportError: vi.fn(),
  reportErrorOnce: vi.fn(),
}));

vi.mock("@/lib/opennode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/opennode")>()),
  getCharge: mocks.getCharge,
}));
vi.mock("@/lib/airtable", () => ({
  recordPurchase: mocks.recordPurchase,
  markPurchaseFailedIfExists: mocks.markPurchaseFailedIfExists,
  recordSignup: mocks.recordSignup,
  signupCreatedAt: mocks.signupCreatedAt,
}));
vi.mock("@/lib/ticket-store", () => ({
  recordTicket: mocks.recordTicket,
  markTicketFailed: mocks.markTicketFailed,
}));
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

import { POST } from "./route";

const KEY = "opennode-test-key";
const ID = "3f2b8c1a-9d4e-4a6b-8c7d-1e2f3a4b5c6d";
const sign = (id: string) =>
  crypto.createHmac("sha256", KEY).update(id).digest("hex");

function delivery(body: Record<string, string>) {
  return POST(
    new Request("https://metagame.games/api/opennode-webhook", {
      method: "POST",
      body: new URLSearchParams(body).toString(),
    }),
  );
}
const signed = () => delivery({ id: ID, hashed_order: sign(ID) });

function charge(status: string) {
  mocks.getCharge.mockResolvedValue({
    id: ID,
    status,
    amount: 50_000,
    metadata: {
      orderId: "order-1",
      name: "Ada",
      email: "ada@example.com",
      ticketId: "standard",
      ticketLabel: "Standard",
      usd: 325,
      discountCode: "",
      btcAmountDiscounted: 0,
      test: false,
    },
  });
}

const callOrder = (fn: { mock: { invocationCallOrder: number[] } }) =>
  fn.mock.invocationCallOrder[0];
const mirrored = (): PurchaseRecord => mocks.recordPurchase.mock.calls[0][0];
const recorded = (): PurchaseRecord => mocks.recordTicket.mock.calls[0][0];
const emailed = () => mocks.sendTicketConfirmationEmail.mock.calls[0][0];

describe("opennode webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("OPENNODE_KEY", KEY);
    mocks.recordPurchase.mockResolvedValue({ stored: true });
    mocks.recordTicket.mockImplementation(async (p: PurchaseRecord) => ({
      ...p,
      ticketCode: "CODE01",
    }));
    mocks.signupCreatedAt.mockResolvedValue(new Date());
    mocks.sendTicketConfirmationEmail.mockResolvedValue({ sent: true });
    charge("paid");
  });
  afterEach(() => vi.unstubAllEnvs());

  describe("before processing", () => {
    it("needs an id and a good signature", async () => {
      expect((await delivery({})).status).toBe(400);
      expect(
        (await delivery({ id: ID, hashed_order: sign("other") })).status,
      ).toBe(401);
      expect((await delivery({ id: ID, hashed_order: "short" })).status).toBe(
        401,
      );
      expect(mocks.getCharge).not.toHaveBeenCalled();
    });

    it("no-ops without a key outside production", async () => {
      vi.stubEnv("OPENNODE_KEY", "");
      const res = await signed();
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ configured: false });
      expect(mocks.reportErrorOnce).not.toHaveBeenCalled();
    });

    it.each([
      ["NEXT_PUBLIC_VERCEL_ENV", "production"],
      ["OPENNODE_ENV", "live"],
    ])("asks for a retry and alerts without a key when %s=%s", async (k, v) => {
      vi.stubEnv("OPENNODE_KEY", "");
      vi.stubEnv(k, v);
      expect((await signed()).status).toBe(500);
      expect(mocks.reportErrorOnce).toHaveBeenCalledTimes(1);
      // Nothing verified the sender, so nothing it sent goes in the alert.
      expect(JSON.stringify(mocks.reportErrorOnce.mock.calls[0])).not.toContain(
        ID,
      );
      expect(mocks.getCharge).not.toHaveBeenCalled();
      expect(mocks.recordTicket).not.toHaveBeenCalled();
    });

    it("asks for a retry when the charge can't be fetched", async () => {
      mocks.getCharge.mockRejectedValue(new Error("OpenNode down"));
      expect((await signed()).status).toBe(500);
      expect(mocks.recordTicket).not.toHaveBeenCalled();
    });
  });

  describe("status comes from the fetched charge", () => {
    it.each([
      ["processing", "Pending"],
      ["underpaid", "Underpaid"],
    ])("records %s as %s with no email", async (status, recordedAs) => {
      charge(status);
      expect((await signed()).status).toBe(200);
      expect(recorded().status).toBe(recordedAs);
      expect(mocks.sendTicketConfirmationEmail).not.toHaveBeenCalled();
    });

    it("trusts the charge over the posted status", async () => {
      charge("unpaid");
      const res = await delivery({
        id: ID,
        hashed_order: sign(ID),
        status: "paid",
      });
      expect(res.status).toBe(200);
      expect(mocks.recordTicket).not.toHaveBeenCalled();
    });

    it("mirrors the stored status, not a Pending the row refused", async () => {
      charge("processing");
      mocks.recordTicket.mockImplementation(async (p: PurchaseRecord) => ({
        ...p,
        status: "Paid",
        ticketCode: "CODE01",
      }));
      await signed();
      expect(mirrored().status).toBe("Paid");
      expect(mocks.sendTicketConfirmationEmail).not.toHaveBeenCalled();
    });

    it.each(["expired", "refunded"])(
      "marks a %s charge failed, Postgres first",
      async (status) => {
        charge(status);
        expect((await signed()).status).toBe(200);
        expect(callOrder(mocks.markTicketFailed)).toBeLessThan(
          callOrder(mocks.markPurchaseFailedIfExists),
        );
        expect(mocks.recordTicket).not.toHaveBeenCalled();
      },
    );

    it("keeps the Postgres failure when only Airtable can't be updated", async () => {
      charge("expired");
      mocks.markPurchaseFailedIfExists.mockRejectedValue(new Error("Airtable"));
      expect((await signed()).status).toBe(500);
      expect(mocks.markTicketFailed).toHaveBeenCalledWith(ID);
    });
  });

  describe("a paid charge", () => {
    it("writes Postgres, then Airtable, then emails", async () => {
      expect((await signed()).status).toBe(200);
      expect(callOrder(mocks.recordTicket)).toBeLessThan(
        callOrder(mocks.recordPurchase),
      );
      expect(callOrder(mocks.recordPurchase)).toBeLessThan(
        callOrder(mocks.sendTicketConfirmationEmail),
      );
      expect(recorded()).toMatchObject({ id: ID, paymentMethod: "btc" });
    });

    it("emails and mirrors the code the ticket has now, on a stable key", async () => {
      mocks.recordTicket.mockImplementation(async (p: PurchaseRecord) => ({
        ...p,
        ticketCode: "REISSU",
      }));
      await signed();
      expect(emailed()).toMatchObject({
        ticketCode: "REISSU",
        idempotencyKey: `ticket/${ID}`,
      });
      expect(mirrored().ticketCode).toBe("REISSU");
    });

    it("still delivers the ticket and email when Airtable fails, then retries", async () => {
      mocks.recordPurchase.mockRejectedValue(new Error("Airtable 429"));
      expect((await signed()).status).toBe(500);
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
      expect((await signed()).status).toBe(500);
      expect(emailed().idempotencyKey).toBe(`ticket/${ID}`);
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
      expect((await signed()).status).toBe(200);
      expect(mocks.followUpTicketPurchase).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["NEXT_PUBLIC_VERCEL_ENV", "production"],
      ["OPENNODE_ENV", "live"],
    ])(
      "retries when Airtable isn't configured and %s=%s",
      async (name, value) => {
        vi.stubEnv(name, value);
        mocks.recordPurchase.mockResolvedValue({
          stored: false,
          reason: "airtable-not-configured",
        });
        expect((await signed()).status).toBe(500);
        expect(emailed().ticketCode).toBe("CODE01");
        expect(mocks.reportError).toHaveBeenCalledTimes(1);
      },
    );

    it("acknowledges an unconfigured Airtable outside production", async () => {
      mocks.recordPurchase.mockResolvedValue({
        stored: false,
        reason: "airtable-not-configured",
      });
      expect((await signed()).status).toBe(200);
      expect(mocks.reportError).not.toHaveBeenCalled();
    });

    it("sends nothing when Postgres fails, so the retry does it all", async () => {
      mocks.recordTicket.mockRejectedValue(new Error("Neon down"));
      expect((await signed()).status).toBe(500);
      expect(mocks.recordPurchase).not.toHaveBeenCalled();
      expect(mocks.sendTicketConfirmationEmail).not.toHaveBeenCalled();
    });

    it("acknowledges a failed email", async () => {
      mocks.sendTicketConfirmationEmail.mockRejectedValue(new Error("Resend"));
      expect((await signed()).status).toBe(200);
      expect(mocks.reportError).toHaveBeenCalledTimes(1);
    });
  });
});
