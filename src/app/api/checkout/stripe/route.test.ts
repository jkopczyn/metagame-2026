import { beforeEach, describe, expect, it, vi } from "vitest";
const { create, list, getStripe, sendAdminErrorEmail } = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
  getStripe: vi.fn(),
  sendAdminErrorEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/stripe", () => ({ getStripe }));
vi.mock("@/lib/email", () => ({ sendAdminErrorEmail }));
vi.mock("@/lib/early-bird", () => ({ isEarlyBirdActive: () => false }));
import { GET } from "./route";

const get = (query: string) =>
  GET(new Request(`https://metagame.games/api/checkout/stripe?${query}`));

describe("standard checkout with a linked promo code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    getStripe.mockReturnValue({
      checkout: { sessions: { create } },
      promotionCodes: { list },
    });
    list.mockResolvedValue({ data: [{ id: "promo_1", metadata: {} }] });
    create.mockResolvedValue({
      id: "cs_1",
      url: "https://checkout.stripe.com/c/pay/test",
    });
  });

  it("applies the code", async () => {
    expect((await get("tier=standard&promo=FRIEND")).status).toBe(303);
    expect(create.mock.calls[0][0].discounts).toEqual([
      { promotion_code: "promo_1" },
    ]);
  });

  it("checks out without a code Stripe refuses", async () => {
    create.mockRejectedValueOnce(
      Object.assign(new Error("This promotion code cannot be redeemed"), {
        type: "StripeInvalidRequestError",
      }),
    );
    expect((await get("tier=standard&promo=USEDUP")).status).toBe(303);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].discounts).toBeUndefined();
    expect(create.mock.calls[1][0].allow_promotion_codes).toBe(true);
    expect(sendAdminErrorEmail).toHaveBeenCalledTimes(1);
  });

  it("still fails when checkout fails without a code", async () => {
    create.mockRejectedValue(new Error("Stripe down"));
    expect((await get("tier=standard")).status).toBe(502);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
