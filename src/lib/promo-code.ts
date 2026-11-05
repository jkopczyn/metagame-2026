// Client-safe on purpose: utm.ts is in every page's bundle, and tracking-links.ts
// would bring env.ts and the Airtable config along with it.

// /go/<slug>?promo=CODE forwards the code to the destination, where the site
// stores it and applies it at Standard checkout. Stripe decides if it's valid.
export const PROMO_PARAM = "promo";
export function promoCode(value: string | null | undefined): string {
  const code = value?.trim() ?? "";
  return /^[A-Za-z0-9_-]{1,100}$/.test(code) ? code : "";
}
