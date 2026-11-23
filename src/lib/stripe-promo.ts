import Stripe from "stripe";
import { env } from "@/env";
import { STRIPE_CLIENT_OPTIONS } from "@/lib/stripe";

let cached: Stripe | null = null;

/**
 * Stripe client for the promo-code tool, on its own restricted key
 * (Promotion codes: Write, Coupons: Read) so a leak can mint codes but never
 * read charges or refund. Null when STRIPE_PROMO_KEY isn't set, like getStripe().
 */
export function getPromoStripe(): Stripe | null {
  if (cached) return cached;
  const key = env.STRIPE_PROMO_KEY;
  if (!key) return null;
  cached = new Stripe(key, STRIPE_CLIENT_OPTIONS);
  return cached;
}

export type PromoMode = "live" | "test";

/** Live vs test follows the key's prefix; unset counts as test (the cautious default). */
export function promoMode(): PromoMode {
  return /_live_/.test(env.STRIPE_PROMO_KEY ?? "") ? "live" : "test";
}
