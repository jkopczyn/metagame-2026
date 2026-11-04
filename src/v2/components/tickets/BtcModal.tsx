"use client";

import { useEffect, useState } from "react";
import { FaBitcoin } from "react-icons/fa";
import { readUtm } from "@/lib/utm";
import { readCodeCheck, type CodeCheck } from "@/v2/lib/btc-code-check";
import type { TicketTier } from "@/v2/lib/tickets";
import { Button } from "@/v2/components/ui/button";
import { Input } from "@/v2/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/v2/components/ui/dialog";
import { HEADING } from "../styles";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Defensive client-side guard: never navigate to a non-OpenNode host even if the
// API response is tampered with. The server already validates, this is belt-and-suspenders.
function isOpenNodeCheckoutUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return host === "checkout.opennode.com" || host.endsWith(".opennode.com");
  } catch {
    return false;
  }
}

// Mirrors the server cap so over-long input fails fast in the browser too.
const MAX_FIELD_LEN = 200;

export default function BtcModal({
  ticket,
  onClose,
  initialCode = "EARLYBIRD",
}: {
  ticket: TicketTier;
  onClose: () => void;
  // The early-bird tile prefills the advertised code; the standard tile none.
  initialCode?: string;
}) {
  const { full } = ticket.prices;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [discord, setDiscord] = useState("");
  // Validated live against the server.
  const [discountCode, setDiscountCode] = useState(initialCode);
  const [codeState, setCodeState] = useState<
    CodeCheck & { validating: boolean }
  >({ validating: true, valid: false, test: false, btcPrice: null });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live-validate the discount code (on mount + on change, debounced) so the
  // displayed price reflects what the server would actually charge. The charge
  // itself is re-derived server-side — this is display-only.
  useEffect(() => {
    const code = discountCode.trim();
    const controller = new AbortController();
    // setState is deferred into the timer (not run synchronously in the effect
    // body) so the new-Next react-hooks linter doesn't flag a cascading render.
    const t = setTimeout(() => {
      if (!code) {
        setCodeState({
          validating: false,
          valid: false,
          test: false,
          btcPrice: null,
        });
        return;
      }
      setCodeState((s) => ({ ...s, validating: true }));
      fetch("/api/checkout/opennode/validate-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: ticket.id, code }),
        signal: controller.signal,
      })
        .then(readCodeCheck)
        .then((check) => setCodeState({ validating: false, ...check }))
        .catch((err) => {
          if (err?.name === "AbortError") return;
          setCodeState({
            validating: false,
            valid: false,
            test: false,
            btcPrice: null,
          });
        });
    }, 400);
    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [discountCode, ticket.id]);

  const codeEmpty = !discountCode.trim();
  const discounted = codeState.valid && codeState.btcPrice != null;
  const discountOff =
    codeState.btcPrice != null
      ? Number((full.btc - codeState.btcPrice).toFixed(8))
      : null;
  const isTestCode = !codeEmpty && !codeState.validating && codeState.test;
  const codeInvalid =
    !codeEmpty && !codeState.validating && !codeState.valid && !codeState.test;

  async function payWithBtc(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (isTestCode) return setError("Remove the test promo code to continue.");
    if (!name.trim()) return setError("Please enter your name.");
    if (!EMAIL_RE.test(email)) return setError("Please enter a valid email.");

    setSubmitting(true);
    try {
      const res = await fetch("/api/checkout/opennode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId: ticket.id,
          name,
          email,
          // Optional — only send a non-empty handle.
          ...(discord.trim() ? { discord: discord.trim() } : {}),
          // Server re-validates and re-derives the price; an invalid code just
          // falls through to full price.
          ...(discountCode.trim() ? { discountCode: discountCode.trim() } : {}),
          ...readUtm(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.hostedCheckoutUrl) {
        throw new Error(data.error || "Could not start Bitcoin checkout.");
      }
      if (!isOpenNodeCheckoutUrl(data.hostedCheckoutUrl)) {
        throw new Error("Could not start Bitcoin checkout.");
      }
      // Stash the charge id so the return page can poll status (no DB to look it up).
      try {
        if (data.orderId && data.chargeId) {
          localStorage.setItem(`btc-charge:${data.orderId}`, data.chargeId);
        }
      } catch {
        // localStorage unavailable — page falls back to the ?charge= query.
      }
      window.location.href = data.hostedCheckoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-w-[460px] flex-col gap-6 p-6 sm:p-8">
        <div className="flex items-center justify-between gap-2 pr-6">
          <DialogTitle
            className={`${HEADING} flex items-center gap-2 text-[clamp(24px,6vw,30px)]`}
          >
            <FaBitcoin aria-hidden className="text-tan" /> Pay with BTC
          </DialogTitle>
          <span className="flex items-center gap-2 text-lg">
            {discounted ? (
              <>
                <span className="text-cream/45 line-through">
                  &#8383;{full.btc}
                </span>
                <span className="font-semibold text-tan">
                  &#8383;{codeState.btcPrice}
                </span>
              </>
            ) : (
              <span className="font-semibold text-tan">&#8383;{full.btc}</span>
            )}
          </span>
        </div>
        <DialogDescription className="sr-only">
          Pay for your Metagame 2026 ticket with Bitcoin.
        </DialogDescription>

        <form onSubmit={payWithBtc} className="flex flex-col gap-3">
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name*"
            aria-label="Name"
            autoComplete="name"
            maxLength={MAX_FIELD_LEN}
            required
          />
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com*"
            aria-label="Email address"
            autoComplete="email"
            maxLength={MAX_FIELD_LEN}
            required
          />
          <Input
            type="text"
            value={discord}
            onChange={(e) => setDiscord(e.target.value)}
            placeholder="Discord handle (optional)"
            aria-label="Discord handle (optional)"
            maxLength={MAX_FIELD_LEN}
          />
          <div className="flex flex-col gap-1">
            <Input
              type="text"
              value={discountCode}
              onChange={(e) => setDiscountCode(e.target.value)}
              placeholder="Discount code (optional)"
              aria-label="Discount code"
              autoCapitalize="characters"
              maxLength={MAX_FIELD_LEN}
              className={
                discounted
                  ? "border-[#22c55e]/60! text-[#4ade80]! focus:border-[#22c55e]!"
                  : undefined
              }
            />
            {!codeEmpty && codeState.validating && (
              <p className="text-xs text-cream/70">Checking</p>
            )}
            {discounted && !codeState.validating && (
              <p className="text-xs text-[#4ade80]">
                Valid Code: {codeState.label ?? "Discount applied"}{" "}
                &minus;&#8383;
                {discountOff}
              </p>
            )}
            {codeInvalid && (
              <p className="text-xs text-salmon">
                {codeState.rateLimited
                  ? "Couldn\u2019t check this code right now. Please try again in a little while."
                  : codeState.exhausted
                    ? "This code has reached its redemption limit."
                    : "Code not found"}
              </p>
            )}
            {isTestCode && (
              <p className="text-xs text-salmon">
                That&rsquo;s a test code &mdash; it won&rsquo;t apply here.
              </p>
            )}
          </div>
          {error && <p className="text-sm text-salmon">{error}</p>}
          <Button
            type="submit"
            disabled={submitting || isTestCode}
            className="h-12 w-full text-base"
          >
            {submitting ? "Starting checkout…" : "Pay with BTC"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
