import { createHmac } from "node:crypto";
import type Stripe from "stripe";
import { env } from "@/env";
import {
  identityOf,
  legacySlugCode,
  MAX_SLUG_ATTEMPTS,
  normalizeCustomCode,
  normalizeName,
  normalizePurpose,
  normalizeUses,
  PROMO_SOURCE,
  PromoError,
  seedOf,
  type MintInput,
  type MintResult,
  type Prior,
} from "@/lib/promo-codes";
import { getPromoStripe, promoMode } from "@/lib/stripe-promo";
import { getStripe } from "@/lib/stripe";
import { ALPHABET } from "@/lib/ticket-code";
import { getTicket, stripeMode } from "@/lib/tickets";

// Each code is a Stripe promotion code pointing at a
// hand-made dashboard coupon. Never set `customer` on a promotion code — a
// customer-scoped code only redeems when checkout is pre-attached to that
// customer, which breaks self-serve "enter your code" redemption.

export type Coupon = {
  id: string;
  label: string;
  isDefault: boolean;
  kind: "percent" | "amount";
  /** Whole-currency amount off (80 for $80), for amount coupons. */
  amountOff?: number;
  /** Lowercase ISO code, e.g. "usd", for amount coupons. */
  currency?: string;
  percentOff?: number;
};

export type StripeCode = {
  id: string;
  code: string;
  name: string;
  email: string;
  purpose: string;
  notes: string;
  redeemed: number;
  max: number | null; // null = uncapped
  active: boolean;
  created: number; // unix seconds
  coupon: string;
  discount: CodeDiscount | null;
};

const meta = (p: Stripe.PromotionCode): Stripe.Metadata => p.metadata ?? {};

const couponIdOf = (p: Stripe.PromotionCode): string | undefined => {
  const coupon = p.promotion?.coupon;
  return typeof coupon === "string" ? coupon : coupon?.id;
};

function stripeOrThrow(): Stripe {
  const stripe = getPromoStripe();
  if (!stripe)
    throw new PromoError(
      "Stripe isn't configured — set STRIPE_PROMO_KEY.",
      "config",
    );
  return stripe;
}

/** "Student — 50% off", or just the discount when the coupon's name adds nothing. */
function couponLabel(c: Stripe.Coupon | null | undefined): string {
  if (!c) return "";
  const discount =
    c.percent_off != null
      ? `${c.percent_off}% off`
      : c.amount_off != null
        ? `$${(c.amount_off / 100).toFixed(2)} off`
        : (c.name ?? c.id);
  return c.name && c.name !== discount ? `${c.name} — ${discount}` : discount;
}

const validCoupons = async (stripe: Stripe) =>
  (
    await stripe.coupons.list({ limit: 100 }).autoPagingToArray({ limit: 300 })
  ).filter((c) => c.valid);

/** Usable dashboard coupons for the tier dropdown, grouped by kind and sorted ascending. */
export async function listCoupons(): Promise<Coupon[]> {
  const coupons = await validCoupons(stripeOrThrow());
  const magnitude = (c: Stripe.Coupon) =>
    c.percent_off ?? (c.amount_off ?? 0) / 100;
  const kind = (c: Stripe.Coupon) =>
    c.percent_off != null ? ("percent" as const) : ("amount" as const);
  return coupons
    .sort(
      (a, b) =>
        kind(a).localeCompare(kind(b)) ||
        magnitude(a) - magnitude(b) ||
        couponLabel(a).localeCompare(couponLabel(b)),
    )
    .map((c) => ({
      id: c.id,
      label: couponLabel(c),
      isDefault: c.id === env.COMP_COUPON_ID,
      kind: kind(c),
      ...(c.percent_off != null
        ? { percentOff: c.percent_off }
        : {
            amountOff: (c.amount_off ?? 0) / 100,
            currency: c.currency ?? undefined,
          }),
    }));
}

/** Ids of the usable coupons taking exactly `cents` off in USD. */
export async function amountOffCoupons(cents: number): Promise<string[]> {
  const coupons = await validCoupons(stripeOrThrow());
  return coupons
    .filter((c) => c.amount_off === cents && c.currency === "usd")
    .map((c) => c.id);
}

export type FoundCode = { id: string; active: boolean; couponId?: string };

/**
 * The promotion code spelled `code` (Stripe matches any case), preferring an
 * active one when an archived one shares it; null when there's none.
 */
export async function findStripeCode(code: string): Promise<FoundCode | null> {
  const { data } = await stripeOrThrow().promotionCodes.list({
    code,
    limit: 10,
  });
  const promo = data.find((p) => p.active) ?? data[0];
  return promo
    ? { id: promo.id, active: promo.active, couponId: couponIdOf(promo) }
    : null;
}

/** What a coupon takes off, and which products it's limited to (null = any). */
export type CodeDiscount = {
  percentOff?: number;
  /** Whole dollars. */
  amountOff?: number;
  products: string[] | null;
  /** First-time-only, minimum-amount, or customer-bound: not for everyone. */
  restricted: boolean;
};

function discountOf(
  p: Stripe.PromotionCode,
  c: Stripe.Coupon,
): CodeDiscount | null {
  const products = c.applies_to?.products ?? null;
  const r = p.restrictions;
  const restricted =
    !!r?.first_time_transaction || r?.minimum_amount != null || !!p.customer;
  if (c.percent_off != null)
    return { percentOff: c.percent_off, products, restricted };
  if (c.amount_off != null)
    return { amountOff: c.amount_off / 100, products, restricted };
  return null;
}

/** "$50", "$12.50" or "20%". */
export function discountText(d: CodeDiscount): string {
  if (d.percentOff != null) return `${d.percentOff}%`;
  const usd = d.amountOff ?? 0;
  return `$${Number.isInteger(usd) ? usd : usd.toFixed(2)}`;
}

let standardProductId: Promise<string> | undefined;

/**
 * The Standard ticket's Stripe product, read from its price with the site's
 * key (the promo key can't read prices). Coupons scope to products.
 */
export function standardProduct(): Promise<string> {
  standardProductId ??= (async () => {
    const stripe = getStripe();
    if (!stripe)
      throw new PromoError(
        "Stripe isn't configured — set STRIPE_SECRET_KEY.",
        "config",
      );
    const price = await stripe.prices.retrieve(
      getTicket("standard")!.priceIds[stripeMode],
    );
    return typeof price.product === "string" ? price.product : price.product.id;
  })().catch((error) => {
    standardProductId = undefined;
    throw error;
  });
  return standardProductId;
}

/**
 * A code that redeems right now, spelled as Stripe has it; null when it's
 * unknown, archived, expired, or used up.
 */
export async function redeemableCode(
  code: string,
): Promise<{ code: string; discount: CodeDiscount } | null> {
  const { data } = await stripeOrThrow().promotionCodes.list({
    code,
    active: true,
    limit: 10,
    expand: ["data.promotion.coupon.applies_to"],
  });
  const now = Date.now() / 1000;
  for (const p of data) {
    const c = p.promotion?.coupon;
    if (!c || typeof c === "string" || !c.valid) continue;
    if (p.expires_at && p.expires_at < now) continue;
    if (p.max_redemptions != null && p.times_redeemed >= p.max_redemptions)
      continue;
    const discount = discountOf(p, c);
    if (discount) return { code: p.code, discount };
  }
  return null;
}

type Probe =
  | { status: "created"; promo: Stripe.PromotionCode }
  | { status: "reused"; promo: Stripe.PromotionCode; prior: Prior }
  | { status: "taken"; promo: Stripe.PromotionCode };

const SLUG_LEN = 10; // chars after "COMP-"

/**
 * Human-typable code from a seed (email, else name), keyed so that knowing
 * who a code is for doesn't reveal it. Stable per (seed, attempt), so a re-run
 * reproduces the same walk: 0 is the primary code, 1… the fallbacks when the
 * primary is already taken by a different identity.
 */
export function slugCode(secret: string, seed: string, attempt = 0): string {
  const digest = createHmac("sha256", secret)
    .update(`comp-code:${seed.trim().toLowerCase()}#${attempt}`)
    .digest();
  let slug = "";
  for (let i = 0; i < SLUG_LEN; i++) {
    slug += ALPHABET[digest[i] % ALPHABET.length];
  }
  return `COMP-${slug}`;
}

type Resolved = {
  email: string;
  name: string;
  uses: number | null;
  coupon: string;
  purpose: string;
  notes: string;
  issuedBy: string;
};

async function createOrReuse(
  stripe: Stripe,
  code: string,
  { email, name, uses, coupon, purpose, notes, issuedBy }: Resolved,
): Promise<Probe> {
  try {
    const promo = await stripe.promotionCodes.create({
      promotion: { type: "coupon", coupon },
      code,
      ...(uses != null ? { max_redemptions: uses } : {}),
      metadata: {
        email,
        name,
        source: PROMO_SOURCE,
        coupon,
        purpose,
        notes,
        issued_by: issuedBy,
      },
    });
    return { status: "created", promo };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    const dup =
      e.code === "resource_already_exists" ||
      /already exists/i.test(e.message ?? "");
    if (!dup) throw err;
    const p = (await stripe.promotionCodes.list({ code, limit: 1 })).data[0];
    if (!p) throw err;
    if (!isIssuedTo(p, { email, name })) return { status: "taken", promo: p };
    return reuse(stripe, p, { purpose, notes });
  }
}

function isIssuedTo(
  p: Stripe.PromotionCode,
  who: { email: string; name: string },
): boolean {
  const want = identityOf(who);
  const owner = identityOf({ email: meta(p).email, name: meta(p).name });
  // Same guest → reuse. No identity on either side (an anonymous custom code)
  // → reuse only if it's one of ours; never claim a stranger's code.
  return want ? owner === want : meta(p).source === PROMO_SOURCE;
}

async function reuse(
  stripe: Stripe,
  p: Stripe.PromotionCode,
  { purpose, notes }: Pick<Resolved, "purpose" | "notes">,
): Promise<Probe> {
  const prior: Prior = {
    name: meta(p).name ?? "",
    email: meta(p).email ?? "",
    purpose: meta(p).purpose ?? "",
    created: p.created,
    redeemed: p.times_redeemed ?? 0,
  };
  // A re-run is how a mis-filed code gets fixed: carry the new purpose/notes
  // onto it (the stripe-webhook re-mirrors on promotion_code.updated).
  const patch: Record<string, string> = {};
  if (purpose !== (meta(p).purpose ?? "")) patch.purpose = purpose;
  if (notes && notes !== (meta(p).notes ?? "")) patch.notes = notes;
  const promo = Object.keys(patch).length
    ? await stripe.promotionCodes.update(p.id, { metadata: patch })
    : p;
  return { status: "reused", promo, prior };
}

/** A code this person already holds under the old scheme, walked the way it was minted. */
async function legacyCodeFor(
  stripe: Stripe,
  seed: string,
  resolved: Resolved,
): Promise<Probe | null> {
  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    const code = legacySlugCode(seed, attempt);
    const p = (await stripe.promotionCodes.list({ code, limit: 1 })).data[0];
    if (!p) return null;
    if (isIssuedTo(p, resolved)) return reuse(stripe, p, resolved);
  }
  return null;
}

export async function mintStripeCode(
  input: MintInput & { couponId?: string; issuedBy: string },
): Promise<MintResult> {
  const stripe = stripeOrThrow();
  const name = normalizeName(input.name);
  const purpose = normalizePurpose(input.purpose);
  const coupon = input.couponId || env.COMP_COUPON_ID;
  if (!coupon)
    throw new PromoError(
      "No coupon to attach — pick one, or set COMP_COUPON_ID.",
      "config",
    );
  const email = (input.email ?? "").trim();
  const resolved: Resolved = {
    email,
    name,
    uses: normalizeUses(input.maxUses),
    coupon,
    purpose,
    notes: (input.notes ?? "").trim(),
    issuedBy: input.issuedBy,
  };

  const result = (r: Probe): MintResult => ({
    id: r.promo.id,
    code: r.promo.code,
    active: r.promo.active,
    couponId: couponIdOf(r.promo) ?? coupon,
    name,
    email,
    reused: r.status === "reused",
    prior: r.status === "reused" ? r.prior : undefined,
    max: r.promo.max_redemptions ?? null,
    purpose: meta(r.promo).purpose || purpose,
    test: promoMode() === "test",
  });

  const custom = normalizeCustomCode(input.customCode);
  if (custom) {
    const r = await createOrReuse(stripe, custom, resolved);
    if (r.status === "taken")
      throw new PromoError(
        `Code ${r.promo.code} already belongs to a different guest — pick another custom code`,
        "collision",
      );
    return result(r);
  }

  // Always set wherever this is reachable: the callers gate on an account.
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret)
    throw new PromoError(
      "BETTER_AUTH_SECRET isn't set, so no code can be generated — use a custom code.",
      "config",
    );
  const seed = seedOf({ email, name });
  const issued = await legacyCodeFor(stripe, seed, resolved);
  if (issued) return result(issued);
  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    const r = await createOrReuse(
      stripe,
      slugCode(secret, seed, attempt),
      resolved,
    );
    if (r.status !== "taken") return result(r);
  }
  throw new PromoError(
    "Could not find a free code after several attempts — try a custom code",
    "exhausted",
  );
}

/**
 * Every code this tool minted, newest first. Scoped by metadata.source, not
 * coupon, so it spans all tiers; Stripe can't filter by metadata server-side,
 * so list-all-then-filter.
 */
export async function listStripeCodes(): Promise<StripeCode[]> {
  const stripe = stripeOrThrow();
  const codes = await stripe.promotionCodes
    .list({ limit: 100, expand: ["data.promotion.coupon.applies_to"] })
    .autoPagingToArray({ limit: 1000 });
  return codes
    .filter((p) => meta(p).source === PROMO_SOURCE)
    .map((p) => {
      const coupon = p.promotion?.coupon;
      return {
        id: p.id,
        code: p.code,
        name: meta(p).name ?? "",
        email: meta(p).email ?? "",
        purpose: meta(p).purpose ?? "",
        notes: meta(p).notes ?? "",
        redeemed: p.times_redeemed ?? 0,
        max: p.max_redemptions ?? null,
        active: p.active,
        created: p.created,
        coupon: couponLabel(typeof coupon === "string" ? null : coupon),
        discount:
          coupon && typeof coupon !== "string" ? discountOf(p, coupon) : null,
      };
    });
}

/** Stripe can't delete promotion codes, only deactivate; "archive" flips `active`. */
export async function setStripeCodeActive(
  id: string,
  active: boolean,
): Promise<void> {
  await stripeOrThrow().promotionCodes.update(id, { active });
}
