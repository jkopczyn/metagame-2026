import Stripe from "stripe";
import { env } from "@/env";

let cached: Stripe | null = null;

/** The SDK's defaults (80s, 2 retries) would outlast the request they serve. */
export const STRIPE_CLIENT_OPTIONS = {
  timeout: 15_000,
  maxNetworkRetries: 1,
} as const;

/**
 * Server-side Stripe client, or null when STRIPE_SECRET_KEY isn't set so the
 * webhook can no-op in local dev (mirroring the Airtable graceful-degrade).
 * apiVersion is intentionally omitted — the SDK pins its own, which matches its
 * types.
 */
export function getStripe(): Stripe | null {
  if (cached) return cached;
  const key = env.STRIPE_SECRET_KEY;
  if (!key) return null;
  cached = new Stripe(key, STRIPE_CLIENT_OPTIONS);
  return cached;
}
