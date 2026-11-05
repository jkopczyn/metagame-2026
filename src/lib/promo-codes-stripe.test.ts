import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  env: { BETTER_AUTH_SECRET: "secret-one" as string | undefined },
  stripe: {
    promotionCodes: { create: vi.fn(), list: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/env", () => ({ env: h.env }));
vi.mock("@/lib/stripe-promo", () => ({
  getPromoStripe: () => h.stripe,
  promoMode: () => "test",
}));
vi.mock("@/lib/stripe", () => ({ getStripe: vi.fn() }));
vi.mock("@/lib/tickets", () => ({ getTicket: vi.fn(), stripeMode: vi.fn() }));

import { legacySlugCode } from "./promo-codes";
import { mintStripeCode, slugCode } from "./promo-codes-stripe";

const EMAIL = "speaker@example.com";
const mint = (overrides = {}) =>
  mintStripeCode({
    name: "Speaker",
    email: EMAIL,
    maxUses: 1,
    purpose: "Speaker",
    couponId: "coupon",
    issuedBy: "Organizer",
    ...overrides,
  });

/** What Stripe holds, by code. */
let issued: Record<string, object>;
const held = (code: string, metadata: object, extra = {}) => {
  issued[code] = {
    id: `promo_${code}`,
    code,
    active: true,
    max_redemptions: 1,
    metadata: { source: "comp-tool", ...metadata },
    ...extra,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  h.env.BETTER_AUTH_SECRET = "secret-one";
  issued = {};
  h.stripe.promotionCodes.list.mockImplementation(async ({ code }) => ({
    data: issued[code] ? [issued[code]] : [],
  }));
  h.stripe.promotionCodes.create.mockImplementation(async (params) => {
    if (issued[params.code]) {
      throw Object.assign(new Error("already exists"), {
        code: "resource_already_exists",
      });
    }
    held(params.code, params.metadata);
    return issued[params.code];
  });
});

describe("slugCode", () => {
  it("is stable, and ignores case and spacing in the seed", () => {
    expect(slugCode("k", " Ada@Example.com ")).toBe(
      slugCode("k", "ada@example.com"),
    );
  });

  it("depends on the key, the seed and the attempt", () => {
    const code = slugCode("k", "ada@example.com");
    expect(slugCode("other", "ada@example.com")).not.toBe(code);
    expect(slugCode("k", "bob@example.com")).not.toBe(code);
    expect(slugCode("k", "ada@example.com", 1)).not.toBe(code);
  });

  it("is typable, and long enough not to guess", () => {
    expect(slugCode("k", "ada@example.com")).toMatch(
      /^COMP-[0-9A-HJKMNP-TV-Z]{10}$/,
    );
  });
});

describe("mintStripeCode", () => {
  it("mints a keyed code, not one derived from the email alone", async () => {
    const minted = await mint();
    expect(minted.code).toBe(slugCode("secret-one", EMAIL));
    expect(minted.code).not.toBe(legacySlugCode(EMAIL));
    expect(minted.reused).toBe(false);
  });

  it("returns the same code on a re-run, with no second mint", async () => {
    const first = await mint();
    const again = await mint();
    expect(again.code).toBe(first.code);
    expect(again.reused).toBe(true);
    expect(Object.keys(issued)).toEqual([first.code]);
  });

  it("carries a corrected purpose onto the code on a re-run", async () => {
    await mint();
    h.stripe.promotionCodes.update.mockImplementation(async (id) => ({
      ...Object.values(issued).find((p) => (p as { id: string }).id === id),
    }));
    await mint({ purpose: "Staff" });
    expect(h.stripe.promotionCodes.update).toHaveBeenCalledWith(
      expect.any(String),
      { metadata: { purpose: "Staff" } },
    );
  });

  it("returns a code already issued under the old scheme instead of a second one", async () => {
    const old = legacySlugCode(EMAIL);
    held(old, { email: EMAIL, name: "Speaker", purpose: "Speaker" });
    const minted = await mint();
    expect(minted.code).toBe(old);
    expect(minted.reused).toBe(true);
    expect(h.stripe.promotionCodes.create).not.toHaveBeenCalled();
  });

  it("finds an old code on a later step of the old walk", async () => {
    held(legacySlugCode(EMAIL), { email: "someone@example.com" });
    const second = legacySlugCode(EMAIL, 1);
    held(second, { email: EMAIL, purpose: "Speaker" });
    expect((await mint()).code).toBe(second);
  });

  it("mints a new code when the old code belongs to someone else", async () => {
    held(legacySlugCode(EMAIL), { email: "someone@example.com" });
    expect((await mint()).code).toBe(slugCode("secret-one", EMAIL));
  });

  it("walks on when a keyed code belongs to someone else", async () => {
    held(slugCode("secret-one", EMAIL), { email: "someone@example.com" });
    expect((await mint()).code).toBe(slugCode("secret-one", EMAIL, 1));
  });

  it("leaves custom codes alone", async () => {
    const minted = await mint({ customCode: "elysian" });
    expect(minted.code).toBe("ELYSIAN");
    expect(h.stripe.promotionCodes.list).not.toHaveBeenCalled();
  });

  it("won't fall back to an unkeyed code without the secret", async () => {
    h.env.BETTER_AUTH_SECRET = undefined;
    await expect(mint()).rejects.toThrow("BETTER_AUTH_SECRET");
    expect(h.stripe.promotionCodes.create).not.toHaveBeenCalled();
    expect((await mint({ customCode: "ELYSIAN" })).code).toBe("ELYSIAN");
  });
});
