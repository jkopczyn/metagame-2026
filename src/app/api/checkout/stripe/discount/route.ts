import { NextResponse } from "next/server";
import { resolveDiscount } from "@/lib/referral-checkout";
import { getStripe } from "@/lib/stripe";
import { throttled } from "@/lib/throttle";
import { getTicket } from "@/lib/tickets";

export const runtime = "nodejs";

/**
 * GET /api/checkout/stripe/discount?code=<code>
 * What a code takes off a Standard ticket, for the discount modal; null when
 * it isn't live. Advisory: checkout resolves the code again.
 */
export async function GET(request: Request) {
  const limited = await throttled(request, "codeLookup");
  if (limited) return limited;
  const stripe = getStripe();
  const code = new URL(request.url).searchParams.get("code");
  const full = getTicket("standard")!.prices.full.usd;
  let usdOff: number | null = null;
  try {
    if (stripe)
      usdOff = (await resolveDiscount(stripe, code, full))?.usdOff ?? null;
  } catch (err) {
    console.error("[checkout/stripe/discount] lookup failed:", err);
  }
  return NextResponse.json({ full, usdOff });
}
