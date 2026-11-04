// USD checkout goes through /api/checkout/stripe, which creates a Checkout Session
// from the Price IDs below. Price IDs aren't secrets, so both modes are committed;
// live serves only in production, and local dev + Vercel previews use the sandbox.
// The old Payment Links stay live (and matched by the webhook) for anyone holding
// one.
//
// BTC prices are hardcoded (no live conversion). The actual BTC charge is now
// code-driven: full price by default, lowered by a validated Airtable discount
// code (see src/lib/discount-codes.ts). `earlyBird.btc` here is just the
// advertised default the homepage button shows.

export type StripeMode = "test" | "live";

// Must be NEXT_PUBLIC_* — this module is imported by client components (the ticket
// buttons + modals), and Next only inlines NEXT_PUBLIC_ vars into the browser bundle.
// Plain VERCEL_ENV is undefined client-side, which silently pinned every link to test.
// Vercel auto-exposes NEXT_PUBLIC_VERCEL_ENV for Next.js projects.
export const stripeMode: StripeMode =
  process.env.NEXT_PUBLIC_VERCEL_ENV === "production" ? "live" : "test";

/** A price point in both currencies. usd = dollars, btc = whole bitcoin. */
export type Price = {
  usd: number;
  btc: number;
};

export type TicketTier = {
  id: string;
  label: string;
  prices: {
    full: Price; // pre-discount, shown struck-through for anchoring
    earlyBird: Price; // what they pay once the promo / BTC discount applies
  };
  promoCode?: string; // Stripe promotion code auto-applied during early-bird
  links: Record<StripeMode, string>;
  priceIds: Record<StripeMode, string>;
};

export const ticketTiers: TicketTier[] = [
  {
    id: "standard",
    label: "Standard",
    prices: {
      full: { usd: 425, btc: 0.0065 },
      // The actual BTC charge is now code-driven (Airtable "Discount Codes" table);
      // earlyBird.btc here is just the advertised default the homepage button shows,
      // matching the seeded EARLYBIRD code. Don't read it for the charge amount.
      earlyBird: { usd: 325, btc: 0.005 },
    },
    // Must match the promotion code string created in Stripe ($100-off coupon).
    promoCode: "EARLYBIRD",
    links: {
      test: "https://buy.stripe.com/test_7sY8wO7kj5J5cF56J4fw402",
      live: "https://buy.stripe.com/fZu8wO5cb2wT5cD6J4fw405",
    },
    priceIds: {
      test: "price_1TjWcrCtO443EG3nD39mtOlw",
      live: "price_1TjWI3CtO443EG3njBAhYYWO",
    },
  },
];

/** Look up a tier by id; undefined when none matches. */
export function getTicket(id: string): TicketTier | undefined {
  return ticketTiers.find((t) => t.id === id);
}

// The $250 booth-only Night Market purchase; /booth redirects to the active mode's link.
export const boothLinks: Record<StripeMode, string> = {
  test: "https://buy.stripe.com/test_eVq4gy7kjefBbB12sOfw40m",
  live: "https://buy.stripe.com/aFacN4343dbxcF58Rcfw40h",
};

// ── Supporter tier ──────────────────────────────────────────────────────────
// A pay-what-you-want tier (floor $525 / ₿0.0087) sitting alongside the standard
// ticket. USD checkout uses one custom-amount Stripe price per quick-pick amount;
// BTC checkout goes through the OpenNode modal with an editable amount.

/** One quick-pick amount: a USD Stripe preset + its hardcoded BTC equivalent. */
export type SupporterChip = {
  usd: number; // Stripe price preset (dollars)
  btc: number; // ~equivalent whole BTC, hardcoded
  links: Record<StripeMode, string>; // Payment Link for this chip's custom-amount Stripe price
  priceIds: Record<StripeMode, string>; // custom-amount price whose preset is this chip
};

export type SupporterTier = {
  id: "supporter";
  label: string;
  floor: Price; // minimum accepted in either currency
  defaultChipUsd: number; // which chip is selected when the modal opens
  chips: SupporterChip[];
};

export const supporterTier: SupporterTier = {
  id: "supporter",
  label: "Supporter",
  floor: { usd: 525, btc: 0.0087 },
  defaultChipUsd: 650,
  chips: [
    {
      usd: 525,
      btc: 0.0087,
      links: {
        test: "https://buy.stripe.com/test_00wcN43430oLcF5aZkfw40b",
        live: "https://buy.stripe.com/4gM9AS5cb1sP8oP6J4fw406",
      },
      priceIds: {
        test: "price_1Tme4HCtO443EG3nSx8R2VB1",
        live: "price_1TmdmWCtO443EG3nFy8f4XKA",
      },
    },
    {
      usd: 650,
      btc: 0.0108,
      links: {
        test: "https://buy.stripe.com/test_eVq14m0VV2wT7kL8Rcfw40c",
        live: "https://buy.stripe.com/bJeaEW1ZZ2wT48z8Rcfw407",
      },
      priceIds: {
        test: "price_1Tme4HCtO443EG3nsiPyocey",
        live: "price_1Tmdx6CtO443EG3njyqbwa6J",
      },
    },
    {
      usd: 750,
      btc: 0.0124,
      links: {
        test: "https://buy.stripe.com/test_6oU4gy343fjF9sTebwfw40d",
        live: "https://buy.stripe.com/3cIeVc9sr4F1dJ91oKfw408",
      },
      priceIds: {
        test: "price_1Tme4HCtO443EG3nIn5Biukt",
        live: "price_1TmdoLCtO443EG3n2lA6EkVY",
      },
    },
    {
      usd: 1024,
      btc: 0.017,
      links: {
        test: "https://buy.stripe.com/test_4gM4gy3435J56gH9Vgfw40e",
        live: "https://buy.stripe.com/4gMaEWcED7RdeNdgjEfw409",
      },
      priceIds: {
        test: "price_1Tme4HCtO443EG3n9Llt5UFZ",
        live: "price_1TmdxyCtO443EG3nT07mUEyW",
      },
    },
  ],
};

// ── Day passes ──────────────────────────────────────────────────────────────
// Single-day admission. USD via Stripe Checkout; BTC via the OpenNode modal at
// a fixed price scaled off Standard's ₿/$ ratio (no discount codes on either rail).
// Promo codes are off for these so EARLYBIRD can't take $100 off a $100 pass.

export type DayPass = {
  id: "friday" | "saturday" | "sunday";
  label: string;
  usd: number;
  btc: number;
  /** The admitted day — drives the confirmation email's date line + calendar link. */
  date: { long: string; ymd: string };
  links: Record<StripeMode, string>;
  priceIds: Record<StripeMode, string>;
};

export const dayPasses: DayPass[] = [
  {
    id: "friday",
    label: "Friday Day Pass",
    usd: 100,
    btc: 0.0015,
    date: { long: "Friday, November 6, 2026", ymd: "20261106" },
    links: {
      test: "https://buy.stripe.com/test_fZubJ0gUTgnJfRh9Vgfw40i",
      live: "https://buy.stripe.com/6oU4gy343fjF9sTebwfw40d",
    },
    priceIds: {
      test: "price_1UIdmLCtO443EG3nQIZ4R1Lc",
      live: "price_1UIdmdCtO443EG3nPMl8uydB",
    },
  },
  {
    id: "saturday",
    label: "Saturday Day Pass",
    usd: 225,
    btc: 0.0034,
    date: { long: "Saturday, November 7, 2026", ymd: "20261107" },
    links: {
      test: "https://buy.stripe.com/test_7sYbJ07kj7Rd5cD7N8fw40j",
      live: "https://buy.stripe.com/4gM4gy3435J56gH9Vgfw40e",
    },
    priceIds: {
      test: "price_1UIdmOCtO443EG3nR9Bz9z81",
      live: "price_1UIdmgCtO443EG3neSp7TgeI",
    },
  },
  {
    id: "sunday",
    label: "Sunday Day Pass",
    usd: 225,
    btc: 0.0034,
    date: { long: "Sunday, November 8, 2026", ymd: "20261108" },
    links: {
      test: "https://buy.stripe.com/test_7sYdR8dIHfjF48zd7sfw40k",
      live: "https://buy.stripe.com/7sYdR8gUT2wT5cDc3ofw40f",
    },
    priceIds: {
      test: "price_1UIdmRCtO443EG3n1GmE29fK",
      live: "price_1UIdmjCtO443EG3nIuTujyLM",
    },
  },
];

/** Look up a day pass by id; undefined when none matches. */
export function getDayPass(id: string): DayPass | undefined {
  return dayPasses.find((p) => p.id === id);
}

/** The day pass a Stripe Payment Link URL (either mode) sells, if any. */
export function dayPassForPaymentLinkUrl(
  url: string | null | undefined,
): DayPass | undefined {
  if (!url) return undefined;
  return dayPasses.find((p) => Object.values(p.links).includes(url));
}

export const DAY_PASS_TIER = "day-pass";

/**
 * Tier label + admitted day from the metadata /api/checkout/stripe puts on a
 * Checkout Session. Undefined for sessions it didn't create (old Payment Links).
 */
export function tierForCheckoutMetadata(
  metadata: Record<string, string> | null | undefined,
): { label: string; day?: DayPass["date"] } | undefined {
  const tier = metadata?.tier;
  if (tier === DAY_PASS_TIER) {
    const pass = getDayPass(metadata?.day ?? "");
    return pass && { label: pass.label, day: pass.date };
  }
  if (tier === supporterTier.id) return { label: supporterTier.label };
  const ticket = tier ? getTicket(tier) : undefined;
  return ticket && { label: ticket.label };
}

/**
 * Tier label ("Standard" / "Supporter" / "Friday Day Pass") for a Stripe Payment
 * Link URL, matched against the links above (both modes). Undefined for an
 * unknown link — e.g. one created in the dashboard outside this file.
 */
export function tierLabelForPaymentLinkUrl(
  url: string | null | undefined,
): string | undefined {
  if (!url) return undefined;
  for (const tier of ticketTiers) {
    if (Object.values(tier.links).includes(url)) return tier.label;
  }
  for (const chip of supporterTier.chips) {
    if (Object.values(chip.links).includes(url)) return supporterTier.label;
  }
  return dayPassForPaymentLinkUrl(url)?.label;
}

// Stripe product names → tier labels, for checkouts that come from neither
// /api/checkout/stripe nor a Payment Link in this file (e.g. a product made in
// the dashboard and sold through a dashboard-issued checkout). Keys are matched
// case-insensitively on the product name as Stripe reports it.
const PRODUCT_TIER_LABELS: Record<string, string> = {
  "metagame 2026": ticketTiers[0].label,
  "metagame 2026 -- supporter": supporterTier.label,
  "metagame 2026 day pass - friday": "Friday Day Pass",
  "metagame 2026 day pass - saturday": "Saturday Day Pass",
  "metagame 2026 day pass - sunday": "Sunday Day Pass",
  "metagame 2026 - guest of honor": "Guest of Honor",
};

/**
 * The tier label to store for a Stripe checkout, so the tickets table and the
 * Airtable "Ticket Type" read "Standard" / "Supporter" / "Guest of Honor" no
 * matter which rail sold the ticket (BTC checkouts already store labels).
 * Site-created sessions carry the tier in metadata; old Payment Links match by
 * URL; anything else maps by product name, falling back to the raw name so an
 * unmapped product is still recorded rather than blank.
 */
export function tierLabelForStripeCheckout({
  metadata,
  paymentLinkUrl,
  productName,
}: {
  metadata: Record<string, string> | null | undefined;
  paymentLinkUrl: string | null | undefined;
  productName: string | undefined;
}): string | undefined {
  return (
    tierForCheckoutMetadata(metadata)?.label ??
    tierLabelForPaymentLinkUrl(paymentLinkUrl) ??
    (productName && PRODUCT_TIER_LABELS[productName.trim().toLowerCase()]) ??
    productName
  );
}
