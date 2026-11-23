import type Stripe from "stripe";
import {
  recordPurchase,
  type PurchaseRecord,
  type PurchaseStatus,
} from "@/lib/airtable";
import { sendTicketConfirmationEmail } from "@/lib/email";
import {
  FAMILY_PACK,
  STANDARD_USD,
  attendeesFromMetadata,
  allocateCents,
} from "@/lib/family-pack";
import { capturePurchase } from "@/lib/posthog-server";
import { followUpTicketPurchase } from "@/lib/ticket-followup";
import { recordTicket, type StoredPurchase } from "@/lib/ticket-store";
import { pickUtm } from "@/lib/utm";

/**
 * Throws when a ticket row or an email fails. An Airtable failure comes back as
 * `mirrorError` instead, once the tickets and emails are out; the caller still
 * ends in a 500, so Stripe's retry fills Airtable in. `replayed` says an earlier
 * delivery already wrote every admission.
 */
export async function recordFamilyPack(
  session: Stripe.Checkout.Session,
  status: PurchaseStatus,
): Promise<{ mirrorError?: unknown; replayed: boolean }> {
  const attendees = attendeesFromMetadata(session.metadata);
  if (
    session.currency !== "usd" ||
    session.amount_total !== attendees.length * FAMILY_PACK.usd * 100 ||
    session.total_details?.amount_discount
  )
    throw new Error("Family pack payment does not match its admissions.");
  const intent =
    typeof session.payment_intent === "object" ? session.payment_intent : null;
  const charge =
    intent && typeof intent.latest_charge === "object"
      ? intent.latest_charge
      : null;
  const balance =
    charge && typeof charge.balance_transaction === "object"
      ? charge.balance_transaction
      : null;
  const paymentId = intent?.id ?? session.payment_intent ?? session.id;
  const stored: StoredPurchase[] = [];
  for (const [index, attendee] of attendees.entries()) {
    const purchase: PurchaseRecord = {
      id: `${paymentId}:ticket:${index + 1}`,
      customerName: attendee.name,
      customerEmail: attendee.email,
      discordHandle: attendee.discord,
      billingName: session.customer_details?.name ?? undefined,
      billingEmail: session.customer_details?.email ?? undefined,
      amount: FAMILY_PACK.usd,
      fee: balance
        ? allocateCents(balance.fee, attendees.length, index) / 100
        : undefined,
      net: balance
        ? allocateCents(balance.net, attendees.length, index) / 100
        : undefined,
      ticketType: `${FAMILY_PACK.label} — Standard`,
      status,
      paymentMethod: "stripe",
      test: !session.livemode,
      receiptUrl: charge?.receipt_url ?? undefined,
      notes: `Group order ${paymentId}; admission ${index + 1} of ${attendees.length}. Buyer: ${session.customer_details?.email ?? "unknown"}.`,
      utm: pickUtm((key) => session.metadata?.[key]),
    };
    // A pack is a referral: every admission after the first points at the first.
    stored.push(
      await recordTicket(purchase, {
        referredBy: index > 0 ? stored[0].id : undefined,
      }),
    );
  }
  const tickets = attendees.map((attendee, index) => ({
    ...attendee,
    code: stored[index].ticketCode!,
  }));

  let mirrorError: unknown;
  for (const purchase of stored) {
    await capturePurchase(purchase);
    // One failure is enough to retry the lot; no need to wait out the rest.
    if (mirrorError) continue;
    try {
      const result = await recordPurchase(purchase);
      if (!result.stored)
        throw new Error("Family pack admissions could not be stored.");
    } catch (err) {
      mirrorError = err;
    }
  }

  // A retry only Airtable is holding up: the follow-ups have had their turn. Any
  // other retry can be recovering from a failed email, so it still runs them.
  const replayed = stored.every((purchase) => purchase.replayed);
  const stuckOnMirror = replayed && !!mirrorError;

  if (status === "Paid") {
    const email = session.customer_details?.email;
    if (!email) throw new Error("Family pack buyer email missing.");
    await sendTicketConfirmationEmail({
      to: email,
      purchaserName: session.customer_details?.name ?? undefined,
      tierLabel: `${FAMILY_PACK.label} (${tickets.length} weekend tickets)`,
      usdPaid: (session.amount_total ?? 0) / 100,
      receiptUrl: charge?.receipt_url ?? undefined,
      groupTickets: tickets,
      idempotencyKey: `family-pack/${paymentId}`,
      test: !session.livemode,
    });
    const buyerIsAttendee = tickets.some(
      (t) => t.email.toLowerCase() === email.toLowerCase(),
    );
    if (buyerIsAttendee && !stuckOnMirror)
      await followUpTicketPurchase({
        to: email,
        name: session.customer_details?.name ?? undefined,
        ticketType: `${FAMILY_PACK.label} — Standard`,
        paymentId: `${paymentId}`,
        test: !session.livemode,
        source: "Stripe webhook",
      });
    for (const [index, ticket] of tickets.entries()) {
      if (ticket.email.toLowerCase() === email.toLowerCase()) continue;
      await sendTicketConfirmationEmail({
        to: ticket.email,
        purchaserName: ticket.name,
        tierLabel: `${FAMILY_PACK.label} — Standard weekend`,
        usdPaid: FAMILY_PACK.usd,
        usdFull: STANDARD_USD,
        ticketCode: ticket.code,
        idempotencyKey: `family-pack/${paymentId}/ticket/${index + 1}`,
        test: !session.livemode,
      });
      if (!stuckOnMirror)
        await followUpTicketPurchase({
          to: ticket.email,
          name: ticket.name,
          ticketType: `${FAMILY_PACK.label} — Standard`,
          paymentId: `${paymentId}/ticket/${index + 1}`,
          test: !session.livemode,
          source: "Stripe webhook",
        });
    }
  }
  return { mirrorError, replayed };
}
