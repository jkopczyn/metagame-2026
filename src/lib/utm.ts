import posthog from "posthog-js";
import {
  formatReferralCode,
  REFERRAL_PARAM,
  referralCodeOf,
} from "@/lib/referral";
import { PROMO_PARAM, promoCode } from "@/lib/tracking-links";

// Last-touch attribution: the UTMs from the most recent tracking link a visitor
// arrived through, when they first visited, and their PostHog ids (browser and
// session) ride along into checkout (Stripe session metadata / OpenNode charge
// metadata) and end up on their Airtable purchase row.

const LANDING_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;
export const UTM_KEYS = [
  ...LANDING_KEYS,
  "first_visit",
  "posthog_id",
  "posthog_session_id",
] as const;

export type Utm = Partial<Record<(typeof UTM_KEYS)[number], string>>;

const STORAGE_KEY = "last-touch-utm";
// Visitors from before last-touch stored their landing UTMs here; still the best
// we have for them until they arrive through another tracking link.
const LEGACY_STORAGE_KEY = "first-touch-utm";
const FIRST_VISIT_KEY = "first-visit";
// The discount code from the landing URL (a poster QR, /go/<slug>?promo=CODE,
// or a friend's /invite/<code>), and the referral itself, which counts on any
// ticket whatever code ends up used. Session-scoped: a code from a link months
// ago shouldn't still be applied.
const PROMO_STORAGE_KEY = "promo-code";
const REFERRAL_STORAGE_KEY = "referral-code";
const MAX_LEN = 200;

/** The UTM values `get` returns, trimmed and capped; blanks and non-strings dropped. */
export function pickUtm(
  get: (key: string) => unknown,
  keys: readonly (keyof Utm)[] = UTM_KEYS,
): Utm {
  const utm: Utm = {};
  for (const key of keys) {
    const value = get(key);
    if (typeof value === "string" && value.trim()) {
      utm[key] = value.trim().slice(0, MAX_LEN);
    }
  }
  // Client-supplied, and Airtable rejects the whole row on a bad date.
  if (utm.first_visit) {
    const date = new Date(utm.first_visit);
    if (isNaN(date.getTime())) delete utm.first_visit;
    else utm.first_visit = date.toISOString();
  }
  return utm;
}

/**
 * Record the first visit time, and store the landing URL's UTMs over any earlier
 * set so the latest tracking link wins. A URL without UTMs leaves the set alone.
 * Returns the code a `?promo=` link carried, so the visitor can be told it was
 * saved; a referral's own code isn't announced.
 */
export function captureUtm(search: string): string {
  try {
    if (!localStorage.getItem(FIRST_VISIT_KEY)) {
      localStorage.setItem(FIRST_VISIT_KEY, new Date().toISOString());
    }
    const params = new URLSearchParams(search);
    const utm = pickUtm((key) => params.get(key), LANDING_KEYS);
    if (Object.keys(utm).length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(utm));
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
    const ref = referralCodeOf(params.get(REFERRAL_PARAM));
    if (ref) sessionStorage.setItem(REFERRAL_STORAGE_KEY, ref);
    const linked = promoCode(params.get(PROMO_PARAM));
    const promo = linked || (ref && formatReferralCode(ref));
    if (promo) sessionStorage.setItem(PROMO_STORAGE_KEY, promo);
    return linked;
  } catch {
    // Storage blocked — attribution is best-effort.
    return "";
  }
}

/**
 * Drop utm_*, promo and ref from the address bar once they've been read. PostHog
 * captured them at init, and in history_change mode it only re-fires a pageview
 * when the pathname changes, so a query-only replaceState is silent.
 */
export function stripUtmFromUrl(): void {
  const url = new URL(window.location.href);
  const had = [...url.searchParams.keys()].filter(
    (k) => k.startsWith("utm_") || k === PROMO_PARAM || k === REFERRAL_PARAM,
  );
  if (had.length === 0) return;
  for (const k of had) url.searchParams.delete(k);
  window.history.replaceState(window.history.state, "", url);
}

export function readUtm(): Utm {
  let stored: Record<string, unknown> = {};
  let firstVisit: string | null = null;
  try {
    stored =
      JSON.parse(
        localStorage.getItem(STORAGE_KEY) ??
          localStorage.getItem(LEGACY_STORAGE_KEY) ??
          "{}",
      ) ?? {};
    firstVisit = localStorage.getItem(FIRST_VISIT_KEY);
  } catch {}
  let posthogId: string | undefined;
  let posthogSessionId: string | undefined;
  try {
    // Only set when PostHog initialized (NEXT_PUBLIC_POSTHOG_KEY present).
    if (posthog.__loaded) {
      posthogId = posthog.get_distinct_id();
      posthogSessionId = posthog.get_session_id();
    }
  } catch {}
  return pickUtm(
    (key) =>
      ({
        first_visit: firstVisit,
        posthog_id: posthogId,
        posthog_session_id: posthogSessionId,
      })[key] ?? stored[key],
  );
}

/** `href` with the stored UTMs set as query params. Client-only. */
export function withUtm(href: string): string {
  const url = new URL(href, window.location.origin);
  for (const [key, value] of Object.entries(readUtm())) {
    url.searchParams.set(key, value);
  }
  return url.pathname + url.search;
}

export function readPromo(): string {
  try {
    return promoCode(sessionStorage.getItem(PROMO_STORAGE_KEY));
  } catch {
    return "";
  }
}

/** Replace the stored discount code; blank clears it. */
export function setPromo(code: string): void {
  try {
    const promo = promoCode(code.replace(/\s+/g, ""));
    if (promo) sessionStorage.setItem(PROMO_STORAGE_KEY, promo);
    else sessionStorage.removeItem(PROMO_STORAGE_KEY);
  } catch {}
}

/**
 * `href` with the stored discount code and referral set, so checkout applies
 * the code and records the referral. Client-only.
 */
export function withCodes(href: string): string {
  const url = new URL(href, "http://localhost");
  const promo = readPromo();
  if (promo) url.searchParams.set(PROMO_PARAM, promo);
  try {
    const ref = referralCodeOf(sessionStorage.getItem(REFERRAL_STORAGE_KEY));
    if (ref) url.searchParams.set(REFERRAL_PARAM, ref);
  } catch {}
  return url.pathname + url.search + url.hash;
}
