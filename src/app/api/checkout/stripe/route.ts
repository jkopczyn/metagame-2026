import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { isEarlyBirdActive } from "@/lib/early-bird";
import { getStripe } from "@/lib/stripe";
import {
  DAY_PASS_TIER,
  getDayPass,
  getTicket,
  stripeMode,
  supporterTier,
  type TicketTier,
} from "@/lib/tickets";
import { PREFERRED_CAMPAIGN, slugify } from "@/lib/tracking-links";
import { pickUtm, type Utm } from "@/lib/utm";

export const runtime = "nodejs";

/** Resolve the public origin: prefer NEXT_PUBLIC_SITE_URL, else the request's. */
function resolveOrigin(request: Request): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return new URL(request.url).origin;
}

// Keys must stay "discord" / "preferred_name" — the webhook reads them back.
const CUSTOM_FIELDS: Stripe.Checkout.SessionCreateParams.CustomField[] = [
  {
    key: "discord",
    label: { type: "custom", custom: "Discord" },
    type: "text",
    optional: true,
  },
  {
    key: "preferred_name",
    label: { type: "custom", custom: "Preferred name (if different)" },
    type: "text",
    optional: true,
  },
];

type Purchase = {
  price: string;
  metadata: Record<string, string>;
  // Only full tickets take promo codes; supporter + day passes never did.
  ticket?: TicketTier;
};

function resolvePurchase(params: URLSearchParams): Purchase | undefined {
  const tier = params.get("tier");
  if (tier === supporterTier.id) {
    const chip = supporterTier.chips.find(
      (c) => String(c.usd) === params.get("chip"),
    );
    return chip && { price: chip.priceIds[stripeMode], metadata: { tier } };
  }
  if (tier === DAY_PASS_TIER) {
    const pass = getDayPass(params.get("day") ?? "");
    return (
      pass && {
        price: pass.priceIds[stripeMode],
        metadata: { tier, day: pass.id },
      }
    );
  }
  const ticket = tier ? getTicket(tier) : undefined;
  return (
    ticket && {
      price: ticket.priceIds[stripeMode],
      metadata: { tier: ticket.id },
      ticket,
    }
  );
}

/** Attribution for a comp-tool code's purchase, read off the code itself. */
function compUtm(promo: Stripe.PromotionCode): Utm {
  if (promo.metadata?.source !== "comp-tool") return {};
  const purpose = slugify(promo.metadata.purpose ?? "");
  return {
    utm_source: "comp-tool",
    utm_medium: "comp-link",
    utm_campaign: PREFERRED_CAMPAIGN,
    ...(purpose ? { utm_content: purpose } : {}),
  };
}

/**
 * A `promo` on the link (/ticket/CODE) is applied for the buyer, as is the tier's
 * own code during early-bird; Stripe then shows no code box. Otherwise — or on
 * the unlisted `code=own` link, or when the code isn't redeemable — the box is shown.
 */
async function promoParams(
  stripe: Stripe,
  ticket: TicketTier,
  params: URLSearchParams,
): Promise<{
  session: Pick<
    Stripe.Checkout.SessionCreateParams,
    "discounts" | "allow_promotion_codes"
  >;
  utm: Utm;
}> {
  const box = { session: { allow_promotion_codes: true }, utm: {} };
  const linked = params.get("promo")?.trim();
  const earlyBird =
    params.get("code") !== "own" && isEarlyBirdActive()
      ? ticket.promoCode
      : undefined;
  const code = linked || earlyBird;
  if (!code) return box;
  const {
    data: [promo],
  } = await stripe.promotionCodes.list({ code, active: true, limit: 1 });
  if (!promo) {
    console.warn(
      `[checkout/stripe] no active ${code} promotion code — showing the code box instead`,
    );
    return box;
  }
  return {
    session: { discounts: [{ promotion_code: promo.id }] },
    utm: linked ? compUtm(promo) : {},
  };
}

/**
 * GET /api/checkout/stripe?tier=standard[&code=own | &promo=<code>]
 *   | ?tier=supporter&chip=<usd> | ?tier=day-pass&day=<friday|saturday|sunday>
 *   [&utm_source=…&utm_medium=…&utm_campaign=…&first_visit=…&posthog_id=…&posthog_session_id=…]
 * Creates a hosted Checkout Session and redirects to it. /ticket and /ticket/<code>
 * redirect here (next.config.ts).
 */
export async function GET(request: Request) {
  const stripe = getStripe();
  if (!stripe) {
    return new NextResponse("Checkout isn't available right now.", {
      status: 503,
    });
  }

  const params = new URL(request.url).searchParams;
  const purchase = resolvePurchase(params);
  if (!purchase) {
    return new NextResponse("Unknown ticket.", { status: 400 });
  }

  const origin = resolveOrigin(request);
  try {
    const promo = purchase.ticket
      ? await promoParams(stripe, purchase.ticket, params)
      : undefined;
    const utm = pickUtm((k) => params.get(k));
    // UTMs on the link itself win over the ones a comp code implies.
    const tagged = Object.keys(utm).some((k) => k.startsWith("utm_"));
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: purchase.price, quantity: 1 }],
      ...promo?.session,
      metadata: {
        ...purchase.metadata,
        ...(tagged ? {} : promo?.utm),
        ...utm,
      },
      custom_fields: CUSTOM_FIELDS,
      name_collection: { individual: { enabled: true, optional: false } },
      success_url: `${origin}/thanks?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/#tickets`,
    });
    if (!session.url) throw new Error(`session ${session.id} has no url`);
    return NextResponse.redirect(session.url, 303);
  } catch (err) {
    console.error("[checkout/stripe] session create failed:", err);
    return new NextResponse(
      "Couldn't start checkout. Please go back and try again.",
      { status: 502 },
    );
  }
}
