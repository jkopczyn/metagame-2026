import crypto from "node:crypto";
import { reportError } from "@/lib/error-report";
import { NextResponse } from "next/server";
import { getDayPass, getTicket, supporterTier } from "@/lib/tickets";
import { countCodeRedemptions, lookupDiscountCode } from "@/lib/discount-codes";
import { isEarlyBirdActive } from "@/lib/early-bird";
import { createCharge, getHostedCheckoutUrl } from "@/lib/opennode";
import { pickUtm, type Utm } from "@/lib/utm";

export const runtime = "nodejs";

/** Resolve the public origin: prefer NEXT_PUBLIC_SITE_URL, else the request's. */
function resolveOrigin(request: Request): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return new URL(request.url).origin;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_FIELD_LEN = 200;

export async function POST(request: Request) {
  let body: Utm & {
    ticketId?: string;
    name?: string;
    email?: string;
    discord?: string;
    discountCode?: string;
    btc?: number; // supporter path only: the chosen pay-what-you-want amount
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { ticketId, name, email, discord, discountCode, btc: btcInput } = body;
  if (!ticketId || !name?.trim() || !email?.trim()) {
    return NextResponse.json(
      { error: "ticketId, name, and email are required" },
      { status: 400 },
    );
  }
  if (
    name.length > MAX_FIELD_LEN ||
    email.length > MAX_FIELD_LEN ||
    (discord != null && discord.length > MAX_FIELD_LEN)
  ) {
    return NextResponse.json({ error: "A field is too long" }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  // Shared shape both paths fill in, then feed into the charge + metadata below.
  let ticketIdOut: string;
  let ticketLabel: string;
  let usd: number;
  let btc: number;
  let appliedCode = "";
  let btcAmountDiscounted = 0;

  if (ticketId === supporterTier.id) {
    // Supporter: pay-what-you-want BTC, no discount codes. Re-validate the amount
    // is ≥ floor server-side — never trust the client-sent amount.
    if (typeof btcInput !== "number" || !isFinite(btcInput)) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }
    if (btcInput < supporterTier.floor.btc) {
      return NextResponse.json(
        { error: `Minimum is ₿${supporterTier.floor.btc}` },
        { status: 400 },
      );
    }
    ticketIdOut = supporterTier.id;
    ticketLabel = supporterTier.label;
    btc = btcInput;
    // usd recorded for the Airtable `Amount` — derive from the floor's USD/BTC ratio
    // so the dollar figure roughly tracks the chosen BTC amount.
    usd = Math.round((btc / supporterTier.floor.btc) * supporterTier.floor.usd);
  } else if (getDayPass(ticketId)) {
    // Day pass: fixed BTC price, no discount codes on this rail either.
    const pass = getDayPass(ticketId)!;
    ticketIdOut = pass.id;
    ticketLabel = pass.label;
    usd = pass.usd;
    btc = pass.btc;
  } else {
    const ticket = getTicket(ticketId);
    if (!ticket) {
      return NextResponse.json({ error: "Unknown ticket" }, { status: 400 });
    }

    // The charged BTC price is always server-derived: a valid Airtable discount code
    // lowers it, otherwise full price. A bad/unknown code never charges less — it
    // falls through to full. Never trust a client-sent price.
    const applied = discountCode
      ? await lookupDiscountCode(discountCode)
      : null;
    if (applied?.status === "test") {
      return NextResponse.json(
        { error: "That's a test promo code — it can't be used here." },
        { status: 400 },
      );
    }
    const valid = applied?.status === "valid" ? applied : null;

    // Authoritative redemption-cap check — the point a code is actually consumed.
    // Skip when uncapped (maxUses null). Don't create the charge if over the cap.
    if (valid?.maxUses != null) {
      const used = await countCodeRedemptions(valid.code);
      if (used >= valid.maxUses) {
        return NextResponse.json(
          { error: "This discount code has reached its redemption limit." },
          { status: 409 },
        );
      }
    }

    btc = valid?.btcPrice ?? ticket.prices.full.btc;
    btcAmountDiscounted = valid ? ticket.prices.full.btc - btc : 0;
    // usd is the advertised dollar amount stored as the Airtable `Amount`; the
    // discount only drives the BTC charge, so usd stays anchored to the advertised price.
    usd = isEarlyBirdActive()
      ? ticket.prices.earlyBird.usd
      : ticket.prices.full.usd;
    ticketIdOut = ticket.id;
    ticketLabel = ticket.label;
    appliedCode = valid?.code ?? "";
  }

  const amountSats = Math.round(btc * 1e8);

  const orderId = crypto.randomUUID();
  const origin = resolveOrigin(request);
  const test = process.env.OPENNODE_ENV !== "live";

  // success_url is fixed at creation and we don't yet have the charge id, so it's
  // keyed on our own orderId. The client stashes the returned chargeId (the page
  // needs it to poll status) — see the route handler / confirmation page.
  const successUrl = `${origin}/checkout/bitcoin/${orderId}`;
  const callbackUrl = `${origin}/api/opennode-webhook`;

  // Everything the webhook needs to record the purchase rides along in metadata,
  // since there's no DB to look it up in later.
  const metadata = {
    orderId,
    ticketId: ticketIdOut,
    ticketLabel,
    name: name.trim(),
    email: email.trim(),
    // Optional Discord handle — only ride it along when the buyer supplied one.
    ...(discord?.trim() ? { discord: discord.trim() } : {}),
    ...pickUtm((key) => body[key as keyof Utm]),
    usd,
    btc,
    discountCode: appliedCode,
    btcAmountDiscounted,
    test,
  };

  let charge;
  try {
    charge = await createCharge({
      amountSats,
      description: `Metagame 2026 ${ticketLabel} ticket — ${email.trim()}`,
      customerEmail: email.trim(),
      orderId,
      metadata,
      callbackUrl,
      successUrl,
    });
  } catch (err) {
    console.error("[opennode] createCharge failed:", err);
    await reportError({
      source: "Bitcoin checkout",
      summary: "Couldn't create the OpenNode charge; the buyer saw an error",
      details: { Ticket: String(ticketId), Buyer: String(email) },
      error: err,
    });
    return NextResponse.json(
      { error: "Could not create Bitcoin charge" },
      { status: 502 },
    );
  }

  const hostedCheckoutUrl = getHostedCheckoutUrl(charge.id, charge);

  return NextResponse.json({
    hostedCheckoutUrl,
    orderId,
    chargeId: charge.id,
  });
}
