import { describe, expect, it } from "vitest";
import {
  EGG_TIER_2027,
  dayPasses,
  supporterTier,
  ticketYear,
  ticketTiers,
  tierLabelForStripeCheckout,
} from "./tickets";

describe("tierLabelForStripeCheckout", () => {
  it("prefers the tier in site checkout metadata", () => {
    expect(
      tierLabelForStripeCheckout({
        metadata: { tier: "standard" },
        paymentLinkUrl: undefined,
        productName: "Metagame 2026",
      }),
    ).toBe("Standard");
    expect(
      tierLabelForStripeCheckout({
        metadata: { tier: "day-pass", day: "saturday" },
        paymentLinkUrl: undefined,
        productName: "Metagame 2026 Day Pass - Saturday",
      }),
    ).toBe("Saturday Day Pass");
  });

  it("matches old Payment Links by URL", () => {
    expect(
      tierLabelForStripeCheckout({
        metadata: null,
        paymentLinkUrl: supporterTier.chips[0].links.live,
        productName: "Metagame 2026 -- Supporter",
      }),
    ).toBe(supporterTier.label);
    expect(
      tierLabelForStripeCheckout({
        metadata: {},
        paymentLinkUrl: dayPasses[0].links.test,
        productName: "whatever",
      }),
    ).toBe(dayPasses[0].label);
  });

  it("maps dashboard-made checkouts by product name, case-insensitively", () => {
    expect(
      tierLabelForStripeCheckout({
        metadata: null,
        paymentLinkUrl: undefined,
        productName: "Metagame 2026",
      }),
    ).toBe(ticketTiers[0].label);
    expect(
      tierLabelForStripeCheckout({
        metadata: null,
        paymentLinkUrl: undefined,
        productName: "Metagame 2026 - Guest of Honor",
      }),
    ).toBe("Guest of Honor");
    expect(
      tierLabelForStripeCheckout({
        metadata: null,
        paymentLinkUrl: undefined,
        productName: "  metagame 2026 -- SUPPORTER ",
      }),
    ).toBe(supporterTier.label);
  });

  it("falls back to the raw product name, or undefined without one", () => {
    expect(
      tierLabelForStripeCheckout({
        metadata: null,
        paymentLinkUrl: "https://buy.stripe.com/unknown",
        productName: "Some New Product",
      }),
    ).toBe("Some New Product");
    expect(
      tierLabelForStripeCheckout({
        metadata: null,
        paymentLinkUrl: undefined,
        productName: undefined,
      }),
    ).toBeUndefined();
  });
});

describe("ticketYear", () => {
  it("files the known 2026 tiers under 2026", () => {
    for (const tier of [
      "Standard",
      "standard",
      "Supporter",
      "Saturday Day Pass",
      "Guest of Honor",
      "Family & Friends Pack — Standard",
      "Metagame 2026",
    ])
      expect(ticketYear(tier)).toBe(2026);
  });

  it("files everything else, including the Egg Tier, under 2027", () => {
    expect(ticketYear(EGG_TIER_2027.label)).toBe(2027);
    expect(ticketYear("Metagame 2027 - Early Bird")).toBe(2027);
    expect(ticketYear(undefined)).toBe(2027);
    expect(
      tierLabelForStripeCheckout({
        metadata: null,
        paymentLinkUrl: EGG_TIER_2027.links.live,
        productName: "Metagame 2027",
      }),
    ).toBe("Metagame 2027 - Egg Tier");
  });

  it("files the retired fixed-price Egg Tier links under 2027", () => {
    const label = tierLabelForStripeCheckout({
      metadata: null,
      paymentLinkUrl: EGG_TIER_2027.retiredLinks.test,
      productName: "Egg",
    });
    expect(label).toBe("Metagame 2027 - Egg Tier");
    expect(ticketYear(label)).toBe(2027);
  });
});
