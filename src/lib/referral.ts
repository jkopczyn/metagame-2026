// Client-safe half of the referral system; the SQL lives in referral-store.ts.

import { FAMILY_PACK, STANDARD_USD } from "@/lib/family-pack";
import { normalizeTicketCode } from "@/lib/ticket-code-format";

// Eight characters (ticket codes are six) so the two can't be mistaken.
export const REFERRAL_CODE_LENGTH = 8;

/** Query param a referral link carries: /invite/<code> → /?ref=<code>#tickets. */
export const REFERRAL_PARAM = "ref";

/** What a referred friend saves: they pay what a pack member pays. */
export const REFERRAL_USD_OFF = STANDARD_USD - FAMILY_PACK.usd;

/** Display form: "ABCDEFGH" → "ABCD-EFGH". Stored dashless. */
export function formatReferralCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** The stored form of a typed or linked code, or "" when it can't be one. */
export function referralCodeOf(value: string | null | undefined): string {
  const code = normalizeTicketCode(value ?? "");
  return code.length === REFERRAL_CODE_LENGTH ? code : "";
}

/** Every ticket refers except Night Market booths. `tier` is a stored tier label. */
export function canRefer(tier: string | null): boolean {
  return !/night market/i.test(tier ?? "");
}

/** Dollars a Stripe coupon takes off a `fullUsd` ticket. */
export function couponUsdOff(
  coupon: {
    percent_off?: number | null;
    amount_off?: number | null;
    currency?: string | null;
  },
  fullUsd: number,
): number {
  if (coupon.percent_off != null)
    return Math.round(fullUsd * coupon.percent_off) / 100;
  if (coupon.amount_off != null && (coupon.currency ?? "usd") === "usd")
    return Math.min(fullUsd, coupon.amount_off / 100);
  return 0;
}
