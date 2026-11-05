import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("day pass sales window", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStripe.mockReturnValue({
      checkout: { sessions: { create } },
      promotionCodes: { list },
    });
    create.mockResolvedValue({
      id: "cs_1",
      url: "https://checkout.stripe.com/c/pay/test",
    });
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => void vi.useRealTimers());

  it.each([
    ["friday", "2026-11-07T07:59:59Z", "2026-11-07T08:00:00Z"],
    ["saturday", "2026-11-08T07:59:59Z", "2026-11-08T08:00:00Z"],
    ["sunday", "2026-11-09T07:59:59Z", "2026-11-09T08:00:00Z"],
  ])("sells %s until Pacific midnight", async (day, before, after) => {
    vi.setSystemTime(new Date(before));
    expect((await get(`tier=day-pass&day=${day}`)).status).toBe(303);
    expect(create).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date(after));
    expect((await get(`tier=day-pass&day=${day}`)).status).toBe(410);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("leaves general tickets on sale", async () => {
    vi.setSystemTime(new Date("2026-11-10T20:00:00Z"));
    expect((await get("tier=standard")).status).toBe(303);
  });

  it("still calls an unknown day unknown", async () => {
    vi.setSystemTime(new Date("2026-11-10T20:00:00Z"));
    expect((await get("tier=day-pass&day=monday")).status).toBe(400);
  });
});
