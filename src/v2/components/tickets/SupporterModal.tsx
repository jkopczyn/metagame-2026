"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { FaBitcoin } from "react-icons/fa";
import { readUtm, withCodes, withUtm } from "@/lib/utm";
import { stripeCheckoutHref, supporterTier } from "@/v2/lib/tickets";
import {
  subscribeCurrency,
  getCurrencySnapshot,
  getCurrencyServerSnapshot,
} from "@/v2/lib/currency-store";
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

const LINK = "underline transition-colors hover:text-tan";

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

export default function SupporterModal({ onClose }: { onClose: () => void }) {
  const { floor, defaultChipUsd, chips } = supporterTier;
  const currency = useSyncExternalStore(
    subscribeCurrency,
    getCurrencySnapshot,
    getCurrencyServerSnapshot,
  );
  const isBtc = currency === "btc";

  const defaultIndex = Math.max(
    0,
    chips.findIndex((c) => c.usd === defaultChipUsd),
  );
  const [selected, setSelected] = useState(defaultIndex);
  const chip = chips[selected];

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [discord, setDiscord] = useState("");
  // BTC-mode editable amount, prefilled from the selected chip. Kept as a string so
  // the field can be mid-edit; parsed on validation/submit.
  const [btcAmount, setBtcAmount] = useState(String(chip.btc));
  // Debounced "below floor" warning — polite, not instant yelling (mirrors BtcModal).
  const [belowFloor, setBelowFloor] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Clicking a chip selects it and (BTC mode) sets the editable amount to its value.
  function pickChip(i: number) {
    setSelected(i);
    setBtcAmount(String(chips[i].btc));
    setBelowFloor(false);
  }

  // Debounced floor check so the red note appears a beat after the user stops typing.
  useEffect(() => {
    const t = setTimeout(() => {
      const n = Number(btcAmount);
      setBelowFloor(btcAmount.trim() !== "" && (!isFinite(n) || n < floor.btc));
    }, 400);
    return () => clearTimeout(t);
  }, [btcAmount, floor.btc]);

  async function payWithBtc(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const amount = Number(btcAmount);
    if (!isFinite(amount) || amount < floor.btc) {
      return setError(`Minimum is ₿${floor.btc}.`);
    }
    if (!name.trim()) return setError("Please enter your name.");
    if (!EMAIL_RE.test(email)) return setError("Please enter a valid email.");

    setSubmitting(true);
    try {
      const res = await fetch("/api/checkout/opennode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId: supporterTier.id,
          name,
          email,
          // Optional — only send a non-empty handle.
          ...(discord.trim() ? { discord: discord.trim() } : {}),
          // Server re-validates this is ≥ floor before charging.
          btc: amount,
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

  function checkoutAtStripe() {
    window.open(
      withCodes(
        withUtm(stripeCheckoutHref({ tier: "supporter", chip: chip.usd })),
      ),
      "_blank",
      "noopener,noreferrer",
    );
  }

  // Quick-pick amount chips — placed differently per mode (USD: above the copy;
  // BTC: below the editable amount input it populates), so defined once here.
  const chipRow = (
    <div className="flex flex-wrap gap-2">
      {chips.map((c, i) => {
        const active = i === selected;
        return (
          <button
            key={c.usd}
            type="button"
            aria-pressed={active}
            onClick={() => pickChip(i)}
            className={`rounded-lg border-[1.5px] px-3 py-2 font-space-mono text-sm tracking-[0.04em] transition-colors sm:px-4 sm:text-base ${
              active
                ? "border-tan bg-tan font-bold text-navy"
                : "border-cream/30 text-cream hover:border-tan"
            }`}
          >
            {isBtc ? <>&#8383;{c.btc}</> : <>${c.usd}</>}
          </button>
        );
      })}
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-w-[460px] flex-col gap-5 p-6 sm:p-8">
        <div className="flex flex-col gap-1 pr-6">
          <DialogTitle
            className={`${HEADING} flex items-center gap-2 text-[clamp(24px,6vw,30px)]`}
          >
            {isBtc && <FaBitcoin aria-hidden className="text-tan" />}
            Supporter Tickets
          </DialogTitle>
          <DialogDescription className="sr-only">
            Support Metagame 2026 with a supporter-tier ticket.
          </DialogDescription>
          {!isBtc && (
            <p className="text-base text-cream/80">
              Help make Metagame 2026 even better!
            </p>
          )}
        </div>

        {isBtc ? (
          <form onSubmit={payWithBtc} className="flex flex-col gap-3">
            <p className="text-sm text-cream/75">
              Help make Metagame 2026 even better! Pay-what-you-want,
              &ge;&#8383;{floor.btc}. There may be benefits/perks for
              Supporters, but we haven&rsquo;t decided if/what those might be
              yet. If you&rsquo;re interested in a more formal sponsorship,
              check out our{" "}
              <Link href="/sponsor" className={LINK}>
                sponsorship packages
              </Link>
              .
            </p>
            <div className="flex flex-col gap-1">
              <label className="font-space-mono text-xs tracking-wide text-cream/60 uppercase">
                Amount (BTC)
              </label>
              <Input
                type="number"
                inputMode="decimal"
                step="0.0001"
                min={floor.btc}
                value={btcAmount}
                onChange={(e) => setBtcAmount(e.target.value)}
                aria-label="BTC amount"
              />
              {belowFloor && (
                <p className="text-xs text-salmon">
                  Minimum is &#8383;{floor.btc}.
                </p>
              )}
            </div>
            {chipRow}
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
            {error && <p className="text-sm text-salmon">{error}</p>}
            <Button
              type="submit"
              disabled={submitting}
              className="h-12 w-full text-base"
            >
              {submitting ? "Starting checkout…" : "Pay with BTC"}
            </Button>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            {chipRow}
            <p className="text-xs text-cream/55">
              You can set any custom amount &ge;$525 at the Stripe checkout
              page.
            </p>
            <p className="text-sm text-cream/75">
              Interested in a formal sponsorship? Check out our{" "}
              <Link href="/sponsor" className={LINK}>
                sponsorship packages
              </Link>
              .
            </p>
            <Button
              type="button"
              onClick={checkoutAtStripe}
              className="h-12 w-full text-base"
            >
              Checkout at Stripe
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
