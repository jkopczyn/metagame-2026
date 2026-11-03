import { NextResponse } from "next/server";
import { reportError } from "@/lib/error-report";
import type Stripe from "stripe";
import { isEarlyBirdActive } from "@/lib/early-bird";
import { sendAdminErrorEmail } from "@/lib/email";
import { REFERRAL_PARAM } from "@/lib/referral";
import {
  referralMetadata,
  resolveDiscount,
  type Discount,
  type DiscountParams,
} from "@/lib/referral-checkout";
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
 * A `promo` (from the discount modal or a /ticket/CODE link) locks in its
 * discount so Stripe shows no code box; the tier's own code counts as the
 * promo during early-bird, except on the unlisted `code=own` link. Without a
 * live one, the box is shown.
 */
async function promoParams(
  stripe: Stripe,
  ticket: TicketTier,
  params: URLSearchParams,
): Promise<{ session: DiscountParams; utm: Utm; discount: Discount | null }> {
  const linked = params.get("promo")?.trim();
  const earlyBird =
    params.get("code") !== "own" && isEarlyBirdActive()
      ? ticket.promoCode
      : undefined;
  const discount = await resolveDiscount(
    stripe,
    linked || earlyBird,
    ticket.prices.full.usd,
  );
  return {
    session: discount?.session ?? { allow_promotion_codes: true },
    utm: linked && discount?.promo ? compUtm(discount.promo) : {},
    discount,
  };
}

/**
 * GET /api/checkout/stripe?tier=standard[&code=own | &promo=<code>][&ref=<referral>]
 *   | ?tier=supporter&chip=<usd> | ?tier=day-pass&day=<friday|saturday|sunday>
 *   [&utm_source=…&utm_medium=…&utm_campaign=…&first_visit=…&posthog_id=…&posthog_session_id=…]
 * Creates a hosted Checkout Session and redirects to it. `ref` is the
 * referral a visitor arrived with (/invite/<code>), recorded on any tier; the
 * tickets section links here, and /ticket and /ticket/<code> redirect here
 * (next.config.ts).
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
    const referral = await referralMetadata(
      params.get(REFERRAL_PARAM),
      promo?.discount,
    );
    const utm = pickUtm((k) => params.get(k));
    // UTMs on the link itself win over the ones a comp code implies.
    const tagged = Object.keys(utm).some((k) => k.startsWith("utm_"));
    const create = (discount: DiscountParams = {}) =>
      stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{ price: purchase.price, quantity: 1 }],
        ...discount,
        metadata: {
          ...purchase.metadata,
          ...referral,
          ...(tagged ? {} : promo?.utm),
          ...utm,
        },
        custom_fields: CUSTOM_FIELDS,
        name_collection: { individual: { enabled: true, optional: false } },
        success_url: `${origin}/thanks?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/#tickets`,
      });
    let session: Stripe.Checkout.Session;
    try {
      session = await create(promo?.session);
    } catch (err) {
      // A dead coupon or code mustn't block the sale: open the code box instead.
      const rejected =
        (err as { type?: string } | null)?.type === "StripeInvalidRequestError";
      if (!rejected || !promo?.session.discounts) throw err;
      console.error("[checkout/stripe] discount rejected, retrying:", err);
      await sendAdminErrorEmail(
        `Checkout discount rejected (${JSON.stringify(promo.session.discounts)}); buyer sent to the open code box: ${err instanceof Error ? err.message : String(err)}`,
      ).catch((e) => console.error("[checkout/stripe] alert failed:", e));
      session = await create({ allow_promotion_codes: true });
    }
    if (!session.url) throw new Error(`session ${session.id} has no url`);
    return NextResponse.redirect(session.url, 303);
  } catch (err) {
    console.error("[checkout/stripe] session create failed:", err);
    await reportError({
      source: "Stripe checkout",
      summary: "Couldn't start a checkout session; the buyer saw an error",
      error: err,
    });
    return new NextResponse(
      "Couldn't start checkout. Please go back and try again.",
      { status: 502 },
    );
  }
}
