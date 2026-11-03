import { NextResponse } from "next/server";
import {
  markPurchaseFailedIfExists,
  recordPurchase,
  recordSignup,
  signupCreatedAt,
  type PurchaseRecord,
  type PurchaseStatus,
} from "@/lib/airtable";
import {
  getCharge,
  getHostedCheckoutUrl,
  verifyWebhookSignature,
} from "@/lib/opennode";
import { capturePurchase } from "@/lib/posthog-server";
import { ticketCode } from "@/lib/ticket-code";
import {
  currentTicketCode,
  markTicketFailed,
  recordTicket,
} from "@/lib/ticket-store";
import { getDayPass } from "@/lib/tickets";
import { mailingListOptOutUrl } from "@/lib/purchase-buyer";
import { pickUtm } from "@/lib/utm";
import { sendTicketConfirmationEmail } from "@/lib/email";
import { reportError } from "@/lib/error-report";
import { followUpTicketPurchase } from "@/lib/ticket-followup";

// HMAC verification + the OpenNode key need Node crypto — keep this off the edge.
export const runtime = "nodejs";

export async function POST(request: Request) {
  // OpenNode posts application/x-www-form-urlencoded.
  const params = new URLSearchParams(await request.text());
  const id = params.get("id") ?? "";
  const hashedOrder = params.get("hashed_order") ?? "";

  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  // Verify the HMAC when a key is configured. verifyWebhookSignature throws if
  // OPENNODE_KEY is unset, so treat that as "unconfigured, skip" rather than 500.
  let keyConfigured = true;
  try {
    if (!verifyWebhookSignature({ id, hashed_order: hashedOrder })) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  } catch {
    keyConfigured = false;
    // In production a missing key isn't an expected dev state — surface it loudly.
    // We still fail closed below (acknowledge, never record an unverified event).
    if (process.env.OPENNODE_ENV === "live") {
      console.error(
        "[opennode-webhook] OPENNODE_KEY unset in live mode — cannot verify webhook; not recording",
      );
    }
  }

  if (!keyConfigured) {
    // Can't trust an unverified event — acknowledge but don't record.
    console.warn("[opennode-webhook] OPENNODE_KEY unset — ignoring event");
    return NextResponse.json({ received: true, configured: false });
  }

  // Always re-fetch — the POSTed status is untrusted, so even a non-"paid" event
  // round-trips to getCharge and we branch on the authoritative fetched status.
  let charge;
  try {
    charge = await getCharge(id);
  } catch (err) {
    // 500 → OpenNode retries; the fetch (not the record) failed, so retry is safe.
    console.error("[opennode-webhook] getCharge failed:", err);
    await reportError({
      source: "OpenNode webhook",
      summary: "Couldn't fetch the charge; OpenNode will retry",
      details: { Charge: id },
      error: err,
      mention: false,
    });
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }

  // Status mapping, derived from the RE-FETCHED charge (the trust boundary —
  // never the POSTed body). OpenNode statuses → our Airtable Status:
  //   processing → "Pending"   (on-chain confirming; record now so the row exists)
  //   paid       → "Paid"      (settled; updates the same upserted row)
  //   underpaid  → "Underpaid"
  //   expired / refunded → self-heal: flip an existing row to "Failed" (below).
  //   everything else (unpaid / unknown) → 200, no record.
  // recordPurchase upserts on ID (= charge id), so the later paid event updates
  // the row a processing event created.
  let recordStatus: PurchaseStatus;
  switch (charge.status) {
    case "paid":
      recordStatus = "Paid";
      break;
    case "processing":
      recordStatus = "Pending";
      break;
    case "underpaid":
      recordStatus = "Underpaid";
      break;
    case "expired":
    case "refunded":
      // Terminal failure. If a row already exists (the charge had reached
      // processing/underpaid and was counted as a redemption), flip it to Failed
      // so a rare stuck-Pending drops out of the redemption count. No row → the
      // charge never counted, so there's nothing to heal (keep the no-op).
      try {
        await markPurchaseFailedIfExists(charge.id);
        await markTicketFailed(charge.id);
      } catch (err) {
        // 500 → OpenNode retries; the update is idempotent on charge id.
        console.error("[opennode-webhook] self-heal to Failed failed:", err);
        await reportError({
          source: "OpenNode webhook",
          summary: "Couldn't mark a lapsed charge Failed; OpenNode will retry",
          details: { Charge: charge.id },
          error: err,
          mention: false,
        });
        return NextResponse.json(
          { error: "Processing failed" },
          { status: 500 },
        );
      }
      return NextResponse.json({ received: true, status: charge.status });
    default:
      return NextResponse.json({ received: true, status: charge.status });
  }

  const meta = (charge.metadata ?? {}) as Record<string, unknown>;
  // charge.amount is in satoshis for a BTC charge — this is the BTC actually
  // settled, not the quoted metadata.btc.
  const btcAmount =
    typeof charge.amount === "number" ? charge.amount / 1e8 : undefined;

  // First on-chain txid, if any. Lightning payments have transactions[] without a tx.
  const btcTxId = charge.transactions?.find((t) => t.tx)?.tx;
  // Heuristic network discriminator pending live verification: we infer On-chain
  // from the presence of an on-chain address/tx, and treat a settled charge with
  // transactions but no on-chain markers as Lightning.
  const hasOnChain = charge.transactions?.some((t) => t.address || t.tx);
  const btcNetwork: "On-chain" | "Lightning" | undefined = hasOnChain
    ? "On-chain"
    : charge.transactions?.length
      ? "Lightning"
      : undefined;

  try {
    const purchase: PurchaseRecord = {
      id: charge.id,
      // A retry after an unclaim must not write the old code back.
      ticketCode: await currentTicketCode(charge.id),
      customerName: meta.name ? String(meta.name) : undefined,
      customerEmail: meta.email ? String(meta.email) : undefined,
      discordHandle: meta.discord ? String(meta.discord) : undefined,
      // usd is the quoted price from metadata, not settled fiat.
      amount: meta.usd != null ? Number(meta.usd) : undefined,
      btcAmount,
      ticketType: meta.ticketLabel ? String(meta.ticketLabel) : undefined,
      couponCode: meta.discountCode ? String(meta.discountCode) : undefined,
      btcAmountDiscounted:
        meta.btcAmountDiscounted != null
          ? Number(meta.btcAmountDiscounted)
          : undefined,
      status: recordStatus,
      test: meta.test === true || meta.test === "true",
      paymentMethod: "btc",
      // getCharge omits the top-level order_id, so read our generated id from
      // metadata (set as metadata.orderId by the create route); fall back to
      // order_id if it's ever present.
      openNodeOrderId: meta.orderId ? String(meta.orderId) : charge.order_id,
      btcTxId,
      // Derived (validated) URL, never an unvalidated payload value.
      hostedCheckoutUrl: getHostedCheckoutUrl(charge.id),
      networkFeeBtc: charge.fee != null ? charge.fee / 1e8 : undefined,
      // getCharge returns fiat_value in cents (create returns dollars); the
      // webhook uses the GET value. Observed against the dev API — re-confirm on
      // the first real charge.
      settledFiatValue:
        charge.fiat_value != null ? charge.fiat_value / 100 : undefined,
      btcNetwork,
      utm: pickUtm((key) => meta[key]),
    };
    await recordPurchase(purchase);
    await recordTicket(purchase);
    await capturePurchase(purchase);
  } catch (err) {
    // 500 → OpenNode retries; recordPurchase upserts on ID, so a retry can't dupe.
    console.error("[opennode-webhook] failed to record purchase:", err);
    await reportError({
      source: "OpenNode webhook",
      summary: "Couldn't record a Bitcoin ticket purchase; OpenNode will retry",
      details: { Charge: charge.id, Buyer: String(meta.email ?? "unknown") },
      error: err,
    });
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }

  // Confirmation email once settled. Soft-fail: the purchase is already
  // recorded, so log + alert instead of a 500 (which would make OpenNode retry).
  const email = meta.email ? String(meta.email) : undefined;
  if (recordStatus === "Paid" && email) {
    // Buyers join the mailing list unless their email has been on it before.
    // Soft-fail, like the email below.
    let addedToMailingList = false;
    try {
      if ((await signupCreatedAt(email)) === null) {
        await recordSignup(email, {
          name: meta.name ? String(meta.name) : undefined,
          test: meta.test === true || meta.test === "true",
        });
        addedToMailingList = true;
      }
    } catch (err) {
      console.error("[opennode-webhook] mailing-list signup failed:", err);
      await reportError({
        source: "OpenNode webhook",
        summary:
          "Mailing-list signup failed for a ticket buyer (the ticket itself is fine)",
        details: { Buyer: email, Charge: charge.id },
        error: err,
        mention: false,
      });
    }

    try {
      await sendTicketConfirmationEmail({
        to: email,
        purchaserName: meta.name ? String(meta.name) : undefined,
        tierLabel: meta.ticketLabel
          ? String(meta.ticketLabel)
          : "Metagame 2026 ticket",
        eventDay: getDayPass(String(meta.ticketId ?? ""))?.date,
        btcPaid: btcAmount,
        btcFull:
          btcAmount != null && meta.btcAmountDiscounted != null
            ? btcAmount + Number(meta.btcAmountDiscounted)
            : undefined,
        discountCode: meta.discountCode ? String(meta.discountCode) : undefined,
        // No Stripe-style receipt on this rail; the settled hosted-checkout page
        // shows the payment details and serves as one.
        receiptUrl: getHostedCheckoutUrl(charge.id, charge),
        ticketCode: ticketCode(charge.id),
        mailingListOptOutUrl: addedToMailingList
          ? mailingListOptOutUrl({ chargeId: charge.id })
          : undefined,
        test: meta.test === true || meta.test === "true",
      });
    } catch (err) {
      console.error("[opennode-webhook] confirmation email failed:", err);
      await reportError({
        source: "OpenNode webhook",
        summary:
          "Ticket confirmation email didn't send; the buyer has no ticket code yet",
        details: { Buyer: email, Charge: charge.id },
        error: err,
      });
    }

    await followUpTicketPurchase({
      to: email,
      name: meta.name ? String(meta.name) : undefined,
      ticketType: meta.ticketLabel ? String(meta.ticketLabel) : undefined,
      paymentId: charge.id,
      test: meta.test === true || meta.test === "true",
      source: "OpenNode webhook",
    });
  }

  return NextResponse.json({ received: true });
}
