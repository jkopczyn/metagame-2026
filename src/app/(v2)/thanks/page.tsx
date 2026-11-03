import type { Metadata } from "next";
import type Stripe from "stripe";
import Link from "next/link";
import { signupCreatedAt } from "@/lib/airtable";
import { referrerName } from "@/lib/referral-store";
import { getStripe } from "@/lib/stripe";
import { FAMILY_PACK } from "@/lib/family-pack";
import ContentPage from "@/v2/components/ContentPage";
import MailingListOptOut from "@/v2/components/tickets/MailingListOptOut";
import PartifulInvite from "@/v2/components/tickets/PartifulInvite";
import { Button } from "@/v2/components/ui/button";

export const metadata: Metadata = {
  title: "Thanks — Metagame 2026",
};

// What a completed Checkout Session tells the thanks page. Null unless Stripe
// is configured and the session exists and paid: the id is attacker-supplied.
async function paidSession(sessionId: string | undefined): Promise<{
  // Set only when the webhook will have just subscribed them, for the opt-out.
  buyer: { sessionId: string; email: string } | null;
  referrer: string | null;
} | null> {
  if (!sessionId) return null;
  const stripe = getStripe();
  if (!stripe) return null;
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    return null;
  }
  if (session.payment_status === "unpaid") return null;
  const [referrer, buyer] = await Promise.all([
    session.metadata?.referred_by
      ? referrerName(session.metadata.referred_by).catch(() => null)
      : null,
    newlySubscribed(session).catch(() => null),
  ]);
  return { buyer: buyer ? { sessionId, email: buyer } : null, referrer };
}

// The buyer's email when this purchase put them on the mailing list: a signup
// row older than the checkout means they were on it already (the webhook left
// them alone); a newer or not-yet-written one is this purchase's.
async function newlySubscribed(
  session: Stripe.Checkout.Session,
): Promise<string | null> {
  if (session.metadata?.tier === FAMILY_PACK.id) return null;
  const email = session.customer_details?.email;
  if (!email) return null;
  const signedUp = await signupCreatedAt(email);
  return signedUp && signedUp.getTime() < session.created * 1000 ? null : email;
}

export default async function ThanksPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string | string[] }>;
}) {
  const { session_id } = await searchParams;
  const paid = await paidSession(
    Array.isArray(session_id) ? session_id[0] : session_id,
  );
  const buyer = paid?.buyer;

  return (
    <ContentPage
      eyebrow="Ticket confirmed"
      title="You're in."
      intro={
        <p>
          Thanks for grabbing a ticket to Metagame 2026 &mdash; your order is
          confirmed and a receipt is on its way. See you November 6&ndash;8 in
          Berkeley.
        </p>
      }
    >
      <div className="flex max-w-[640px] flex-col items-start gap-8">
        {paid?.referrer ? (
          <p className="text-base text-ink">
            You were referred by {paid.referrer}, so you both get the
            bring-a-friend swag.
          </p>
        ) : null}
        <PartifulInvite />
        {buyer ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-base text-ink">
              We also added {buyer.email} to the Metagame mailing list for news
              about this and future events.
            </p>
            <MailingListOptOut
              purchase={{ sessionId: buyer.sessionId }}
              email={buyer.email}
            />
          </div>
        ) : null}
        <Button asChild variant="navy">
          <Link href="/">Back to the site</Link>
        </Button>
      </div>
    </ContentPage>
  );
}
