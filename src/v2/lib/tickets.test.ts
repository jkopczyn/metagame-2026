import { describe, expect, it } from "vitest";
import * as charged from "@/lib/tickets";
import * as displayed from "./tickets";

// What the site shows (./tickets) must be what checkout charges (@/lib/tickets).
const STRIPE_FIELDS = ["links", "priceIds", "promoCode"];
const withoutStripeFields = (item: object) =>
  Object.fromEntries(
    Object.entries(item).filter(([key]) => !STRIPE_FIELDS.includes(key)),
  );

describe("displayed ticket prices", () => {
  it("match the Standard tiers", () => {
    expect(displayed.ticketTiers).toEqual(
      charged.ticketTiers.map(withoutStripeFields),
    );
  });

  it("match the Supporter tier", () => {
    expect(displayed.supporterTier).toEqual({
      ...charged.supporterTier,
      chips: charged.supporterTier.chips.map(withoutStripeFields),
    });
  });

  it("match the day passes", () => {
    expect(displayed.dayPasses).toEqual(
      charged.dayPasses.map(withoutStripeFields),
    );
  });
});
