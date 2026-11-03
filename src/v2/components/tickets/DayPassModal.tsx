"use client";

import { useState, useSyncExternalStore } from "react";
import { FaBitcoin } from "react-icons/fa";
import { readUtm, withCodes, withUtm } from "@/lib/utm";
import { dayPasses, stripeCheckoutHref } from "@/v2/lib/tickets";
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

const DAY_TILE = "h-auto flex-col gap-1 px-3 py-4";
const DAY_LABEL =
  "font-space-mono text-[13px] tracking-[0.18em] text-cream/85 uppercase";
const DAY_NOTE =
  "font-space-mono text-[11px] tracking-[0.08em] text-cream/60 uppercase";

// Single-day admission. USD: each day tile is its Stripe Payment Link. BTC: the
// tiles pick a day, and the form below starts an OpenNode charge for it.
export default function DayPassModal({ onClose }: { onClose: () => void }) {
  const currency = useSyncExternalStore(
    subscribeCurrency,
    getCurrencySnapshot,
    getCurrencyServerSnapshot,
  );
  const isBtc = currency === "btc";

  const [selected, setSelected] = useState(0);
  const pass = dayPasses[selected];
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [discord, setDiscord] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function payWithBtc(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Please enter your name.");
    if (!EMAIL_RE.test(email)) return setError("Please enter a valid email.");

    setSubmitting(true);
    try {
      const res = await fetch("/api/checkout/opennode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId: pass.id,
          name,
          email,
          ...(discord.trim() ? { discord: discord.trim() } : {}),
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

  const tileBody = (p: (typeof dayPasses)[number]) => {
    const [weekday, monthDay] = p.date.long.split(", ");
    return (
      <>
        <span className={DAY_LABEL}>{weekday}</span>
        <span className={`${HEADING} text-[26px] leading-none text-tan`}>
          {isBtc ? <>&#8383;{p.btc}</> : <>${p.usd}</>}
        </span>
        <span className={DAY_NOTE}>{monthDay}</span>
      </>
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-w-[460px] flex-col gap-5 p-6 sm:p-8">
        <div className="flex flex-col gap-1 pr-6">
          <DialogTitle
            className={`${HEADING} flex items-center gap-2 text-[clamp(24px,6vw,30px)]`}
          >
            {isBtc && <FaBitcoin aria-hidden className="text-tan" />}
            Day Passes
          </DialogTitle>
          <DialogDescription className="text-base text-cream/80">
            Admission for a single day of Metagame 2026.
          </DialogDescription>
        </div>

        {isBtc ? (
          <form onSubmit={payWithBtc} className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-3 max-[420px]:grid-cols-1">
              {dayPasses.map((p, i) => (
                <Button
                  key={p.id}
                  type="button"
                  variant="raised"
                  aria-pressed={i === selected}
                  onClick={() => setSelected(i)}
                  className={`${DAY_TILE} ${i === selected ? "border-tan" : "opacity-60"}`}
                >
                  {tileBody(p)}
                </Button>
              ))}
            </div>
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
              className="h-12 w-full gap-2 text-base"
            >
              {submitting ? (
                "Starting checkout…"
              ) : (
                <>
                  <FaBitcoin aria-hidden /> Pay &#8383;{pass.btc} on OpenNode
                </>
              )}
            </Button>
          </form>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 max-[420px]:grid-cols-1">
              {dayPasses.map((p) => {
                const href = stripeCheckoutHref({
                  tier: "day-pass",
                  day: p.id,
                });
                const addUtm = (e: React.MouseEvent<HTMLAnchorElement>) => {
                  e.currentTarget.href = withCodes(withUtm(href));
                };
                return (
                  <Button
                    key={p.id}
                    asChild
                    variant="raised"
                    className={DAY_TILE}
                  >
                    <a
                      href={href}
                      onClick={addUtm}
                      onAuxClick={addUtm}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {tileBody(p)}
                    </a>
                  </Button>
                );
              })}
            </div>
            <p className="text-xs text-cream/55">
              You will be taken to secure Stripe checkout.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
