"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { FaEnvelope } from "react-icons/fa";
import ContentPage from "@/v2/components/ContentPage";
import ContactLink from "@/v2/components/contact/ContactLink";
import PartifulInvite from "@/v2/components/tickets/PartifulInvite";
import { Button } from "@/v2/components/ui/button";
import { isFinal, nextPhase, phaseFor, type Phase } from "./phase";

const STATUS_TIMEOUT_MS = 10_000;
const POLL_MS = 5000;
const noSubscribe = () => () => {};

export default function BitcoinCheckoutPage() {
  const params = useParams<{ orderId: string }>();
  const orderSubject = `Bitcoin order ${params.orderId}`;
  const search = useSearchParams();
  const orderId = params.orderId;

  // Charge id comes from the ?charge= query if present; otherwise from the
  // localStorage stash the modal wrote (keyed on orderId) before redirect. The
  // server can't see that stash, so undefined there means "don't know yet".
  const chargeId = useSyncExternalStore(
    noSubscribe,
    () => {
      const fromQuery = search.get("charge");
      if (fromQuery) return fromQuery;
      try {
        return localStorage.getItem(`btc-charge:${orderId}`);
      } catch {
        return null;
      }
    },
    () => undefined,
  );
  const [polled, setPolled] = useState<Phase>("loading");
  // No charge to look up: nothing will ever arrive, so don't sit on "loading".
  const phase = chargeId === null ? "error" : polled;

  useEffect(() => {
    if (!chargeId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    // Each poll waits for the last, so a slow answer can't overwrite a newer one.
    async function poll() {
      let status: string | null = null;
      try {
        const res = await fetch(
          `/api/checkout/opennode/status?id=${encodeURIComponent(chargeId!)}`,
          { signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) },
        );
        if (res.ok) ({ status } = (await res.json()) as { status: string });
      } catch {
        // Handled as the failed poll below.
      }
      if (stopped) return;
      setPolled((current) => nextPhase(current, status));
      if (status == null || !isFinal(phaseFor(status))) {
        timer = setTimeout(poll, POLL_MS);
      }
    }

    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [chargeId]);

  const settled =
    phase === "paid" ||
    phase === "expired" ||
    phase === "underpaid" ||
    phase === "refunded";

  return (
    <ContentPage eyebrow="Ready to play?" title="Bitcoin checkout">
      <div className="flex max-w-[560px] flex-col items-start gap-6 text-base text-ink/80">
        {phase === "loading" && (
          <p className="text-ink/70">Loading your order&hellip;</p>
        )}

        {phase === "pending" && (
          <div className="flex flex-col items-start gap-3">
            <span
              aria-hidden
              className="h-8 w-8 animate-spin rounded-full border-[3px] border-navy/20 border-t-meeple"
            />
            <p className="text-lg text-ink">
              We&rsquo;re confirming your Bitcoin payment&hellip;
            </p>
            <p className="text-sm text-ink/70">
              This page refreshes automatically. It can take a few minutes for
              the network to confirm.
            </p>
          </div>
        )}

        {phase === "paid" && (
          <div className="flex flex-col items-start gap-3">
            <p className="font-grotesk text-2xl font-bold text-navy">
              Payment received!
            </p>
            <p>
              Your Metagame 2026 ticket is confirmed. We&rsquo;ll follow up by
              email with the details.
            </p>
            <div className="mt-3">
              <PartifulInvite />
            </div>
          </div>
        )}

        {phase === "expired" && (
          <div className="flex flex-col items-start gap-3">
            <p>
              This payment expired before it completed. Please head back and
              start a new ticket purchase.
            </p>
            <Button asChild variant="navy" className="mt-1">
              <Link href="/#tickets">Back to tickets</Link>
            </Button>
          </div>
        )}

        {phase === "underpaid" && (
          <div className="flex flex-col items-start gap-3">
            <p className="font-grotesk text-2xl font-bold text-meeple">
              Partial payment received
            </p>
            <p>
              We received a partial payment that didn&rsquo;t cover the full
              ticket price. Please don&rsquo;t send more without contacting us
              first —{" "}
              <ContactLink
                subject={orderSubject}
                className="font-semibold text-navy underline underline-offset-2"
              >
                contact us
              </ContactLink>{" "}
              and we&rsquo;ll sort it out.
            </p>
          </div>
        )}

        {phase === "refunded" && (
          <div className="flex flex-col items-start gap-3">
            <p>
              This payment was refunded. If that wasn&rsquo;t expected,{" "}
              <ContactLink
                subject={orderSubject}
                className="font-semibold text-navy underline underline-offset-2"
              >
                contact us
              </ContactLink>{" "}
              and we&rsquo;ll help.
            </p>
          </div>
        )}

        {phase === "error" && (
          <p className="text-meeple">
            We couldn&rsquo;t load this order&rsquo;s status. If you completed a
            payment, don&rsquo;t pay again — email us and we&rsquo;ll sort it
            out.
          </p>
        )}

        {settled || phase === "error" ? null : (
          <p className="font-space-mono text-xs tracking-wider text-ink/40 uppercase">
            Order {orderId}
          </p>
        )}

        <span className="text-sm">
          Questions?
          <ContactLink
            subject={orderSubject}
            className="ml-2 inline-flex items-center gap-1 font-semibold text-navy underline underline-offset-2"
          >
            <FaEnvelope size={12} aria-hidden className="translate-y-[1px]" />
            Contact us
          </ContactLink>
        </span>
      </div>
    </ContentPage>
  );
}
