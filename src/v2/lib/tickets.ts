// Display copy of the prices in src/lib/tickets.ts; tickets.test.ts pins them equal.
//
// USD tiles link to /api/checkout/stripe, which creates the Stripe Checkout
// Session (Price IDs, promo, test vs live) server-side — see src/lib/tickets.ts.
//
// BTC prices are hardcoded (no live conversion). The actual BTC charge is now
// code-driven: full price by default, lowered by a validated Airtable discount
// code (see src/lib/discount-codes.ts). `earlyBird.btc` here is just the
// advertised default the homepage button shows.

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
  },
];

/** Look up a tier by id; undefined when none matches. */
export function getTicket(id: string): TicketTier | undefined {
  return ticketTiers.find((t) => t.id === id);
}

// ── Supporter tier ──────────────────────────────────────────────────────────
// A pay-what-you-want tier (floor $525 / ₿0.0087) sitting alongside the standard
// ticket. USD checkout uses one custom-amount Stripe price per quick-pick amount;
// BTC checkout goes through the OpenNode modal with an editable amount.

/** One quick-pick amount: a USD Stripe preset + its hardcoded BTC equivalent. */
export type SupporterChip = {
  usd: number; // Stripe price preset (dollars)
  btc: number; // ~equivalent whole BTC, hardcoded
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
    { usd: 525, btc: 0.0087 },
    { usd: 650, btc: 0.0108 },
    { usd: 750, btc: 0.0124 },
    { usd: 1024, btc: 0.017 },
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
};

export const dayPasses: DayPass[] = [
  {
    id: "friday",
    label: "Friday Day Pass",
    usd: 100,
    btc: 0.0015,
    date: { long: "Friday, November 6, 2026", ymd: "20261106" },
  },
  {
    id: "saturday",
    label: "Saturday Day Pass",
    usd: 225,
    btc: 0.0034,
    date: { long: "Saturday, November 7, 2026", ymd: "20261107" },
  },
  {
    id: "sunday",
    label: "Sunday Day Pass",
    usd: 225,
    btc: 0.0034,
    date: { long: "Sunday, November 8, 2026", ymd: "20261108" },
  },
];

/** Look up a day pass by id; undefined when none matches. */
export function getDayPass(id: string): DayPass | undefined {
  return dayPasses.find((p) => p.id === id);
}

/** Our Stripe checkout route for a USD ticket; it redirects to Stripe. */
export function stripeCheckoutHref(
  params:
    | { tier: "standard"; code?: "own" }
    | { tier: "supporter"; chip: number }
    | { tier: "day-pass"; day: DayPass["id"] },
): string {
  const query = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  );
  return `/api/checkout/stripe?${query}`;
}
