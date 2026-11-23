import { beforeEach, describe, expect, it, vi } from "vitest";

const { createCharge, lookupDiscountCode, countCodeRedemptions } = vi.hoisted(
  () => ({
    createCharge: vi.fn(),
    lookupDiscountCode: vi.fn(),
    countCodeRedemptions: vi.fn(),
  }),
);
vi.mock("@/lib/opennode", () => ({
  BTC_CHECKOUT_OPEN: true,
  createCharge,
  getHostedCheckoutUrl: () => "https://checkout.opennode.com/charge",
}));
vi.mock("@/lib/discount-codes", () => ({
  lookupDiscountCode,
  countCodeRedemptions,
}));
vi.mock("@/lib/error-report", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/early-bird", () => ({ isEarlyBirdActive: () => false }));

import { POST } from "./route";
import { POST as VALIDATE } from "./validate-code/route";

const post = (
  handler: (request: Request) => Promise<Response>,
  body: unknown,
) =>
  handler(
    new Request("https://metagame.games/api/checkout/opennode", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

const buyer = { ticketId: "standard", name: "Ada", email: "ada@example.com" };

describe("bitcoin checkout input", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createCharge.mockResolvedValue({ id: "charge-1" });
    lookupDiscountCode.mockResolvedValue({ status: "none" });
  });

  it.each<[string, unknown]>([
    ["malformed JSON", "{"],
    ["null", null],
    ["a list", []],
    ["a number for ticketId", { ...buyer, ticketId: 1 }],
    ["a number for name", { ...buyer, name: 1 }],
    ["an object for email", { ...buyer, email: {} }],
    ["a number for discord", { ...buyer, discord: 1 }],
    ["a number for discountCode", { ...buyer, discountCode: 1 }],
  ])("refuses %s with a 400", async (_, body) => {
    expect((await post(POST, body)).status).toBe(400);
    expect(createCharge).not.toHaveBeenCalled();
  });

  it("still creates a charge for a good order", async () => {
    const res = await post(POST, buyer);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ chargeId: "charge-1" });
  });

  it("charges full price for a code that doesn't check out", async () => {
    await post(POST, { ...buyer, discountCode: "NOPE", discord: null });
    expect(createCharge).toHaveBeenCalledTimes(1);
  });
});

describe("bitcoin code preview input", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lookupDiscountCode.mockResolvedValue({ status: "none" });
  });

  it.each<[string, unknown]>([
    ["malformed JSON", "{"],
    ["null", null],
    ["a number for code", { code: 1 }],
    ["a number for ticketId", { ticketId: 1 }],
    ["an unknown ticket", { ticketId: "nope" }],
  ])("refuses %s with a 400", async (_, body) => {
    expect((await post(VALIDATE, body)).status).toBe(400);
    expect(lookupDiscountCode).not.toHaveBeenCalled();
  });

  it("previews a good request", async () => {
    const res = await post(VALIDATE, { code: "FRIEND" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ valid: false });
  });
});
