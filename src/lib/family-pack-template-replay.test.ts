import { beforeEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";
const { send, seen } = vi.hoisted(() => ({
  send: vi.fn(),
  seen: new Map<string, string>(),
}));
vi.mock("@/env", () => ({ env: { RESEND_API_KEY: "local-mock-only" } }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));
vi.mock("@/lib/airtable", () => ({
  recordPurchase: vi.fn().mockResolvedValue({ stored: true }),
}));
vi.mock("@/lib/posthog-server", () => ({ capturePurchase: vi.fn() }));
vi.mock("@/lib/ticket-followup", () => ({ followUpTicketPurchase: vi.fn() }));
vi.mock("@/lib/ticket-store", () => ({
  currentTicketCode: vi.fn().mockResolvedValue(undefined),
  recordTicket: vi.fn(async (purchase: { id: string }) => ({
    ...purchase,
    ticketCode: `CODE-${purchase.id}`,
    replayed: false,
  })),
}));
import { recordFamilyPack } from "./family-pack-purchase";
import { packMetadata } from "./family-pack";

const session = {
  id: "cs_replay",
  currency: "usd",
  amount_total: 75000,
  livemode: true,
  total_details: { amount_discount: 0 },
  customer_details: { name: "Buyer", email: "buyer@example.com" },
  metadata: packMetadata([
    { name: "One", email: "one@example.com" },
    { name: "Two", email: "two@example.com" },
  ]),
  payment_intent: { id: "pi_replay", latest_charge: null },
} as unknown as Stripe.Checkout.Session;

beforeEach(() => {
  vi.clearAllMocks();
  seen.clear();
  // As Resend does: a key seen with another body is refused, and stays spent.
  send.mockImplementation(
    async (body: { html: string }, options?: { idempotencyKey?: string }) => {
      const key = options?.idempotencyKey ?? "";
      if (seen.has(key) && seen.get(key) !== body.html)
        return {
          data: null,
          error: {
            name: "invalid_idempotent_request",
            message: "Key already used with a different payload",
          },
        };
      seen.set(key, body.html);
      return { data: { id: "email" }, error: null };
    },
  );
});

it("still reaches the attendees when the buyer's copy went out under an older template", async () => {
  seen.set("family-pack/pi_replay", "<p>the template before this deploy</p>");

  await recordFamilyPack(session, "Paid");

  expect(send.mock.calls.map(([body]) => body.to)).toEqual([
    "buyer@example.com",
    "one@example.com",
    "two@example.com",
  ]);
  expect(seen.get("family-pack/pi_replay")).toContain("before this deploy");
});

it("still fails the delivery on a real send error, so Stripe retries", async () => {
  send.mockResolvedValue({
    data: null,
    error: { name: "application_error", message: "boom" },
  });
  await expect(recordFamilyPack(session, "Paid")).rejects.toThrow(
    "Resend send failed",
  );
});
