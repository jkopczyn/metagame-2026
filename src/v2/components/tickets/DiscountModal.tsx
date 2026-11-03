"use client";

import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { readPromo, setPromo, withCodes, withUtm } from "@/lib/utm";
import { stripeCheckoutHref } from "@/v2/lib/tickets";
import { Button } from "@/v2/components/ui/button";
import { Input } from "@/v2/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/v2/components/ui/dialog";
import { HEADING } from "../styles";

const FIELD_LABEL =
  "font-space-mono text-[12px] tracking-[0.12em] text-cream/70 uppercase";

type Saving = { full: number; usdOff: number | null } | "checking" | "unknown";

/**
 * The stop before Stripe for a Standard ticket when the browser holds a code
 * (from a promo or invite link): shows what it saves and lets the buyer swap
 * or clear it. Whatever's in the box goes to checkout.
 */
export default function DiscountModal({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState(readPromo);
  const [saving, setSaving] = useState<Saving>("checking");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const typed = code.trim();
    if (!typed) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(
        `/api/checkout/stripe/discount?${new URLSearchParams({ code: typed })}`,
        { signal: controller.signal },
      )
        .then((res) => res.json())
        .then(setSaving)
        .catch((err) => {
          if (err?.name !== "AbortError") setSaving("unknown");
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [code]);

  function checkout() {
    setBusy(true);
    setPromo(code);
    window.location.assign(
      withCodes(withUtm(stripeCheckoutHref({ tier: "standard", code: "own" }))),
    );
  }

  const blank = !code.trim();
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="flex max-w-[460px] flex-col gap-5 p-6 sm:p-8">
        <DialogTitle className={`${HEADING} pr-6 text-[clamp(24px,6vw,30px)]`}>
          Standard ticket
        </DialogTitle>
        <DialogDescription className="text-base text-cream/80">
          Here&apos;s the discount code we have saved for you. You can swap in
          another before going to checkout if you have one.
        </DialogDescription>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            checkout();
          }}
          className="flex flex-col gap-4"
        >
          <label className="flex flex-col gap-1.5">
            <span className={FIELD_LABEL}>Discount code</span>
            <Input
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setSaving("checking");
              }}
              autoComplete="off"
              spellCheck={false}
              maxLength={100}
              disabled={busy}
              className="font-mono"
            />
          </label>

          <p className="flex min-h-6 flex-wrap items-baseline gap-x-2 text-sm text-cream/80">
            {blank ? (
              "No code: you can still enter one at checkout."
            ) : saving === "checking" ? (
              "Checking…"
            ) : saving === "unknown" ? (
              "Couldn't check that code; a valid one still applies at checkout."
            ) : saving.usdOff ? (
              <>
                <Check aria-hidden className="size-4 self-center text-moss" />
                <span className="text-cream">${saving.usdOff} off</span>
                <span className="text-cream/50 line-through">
                  ${saving.full}
                </span>
                <span className="text-lg font-bold text-moss">
                  ${saving.full - saving.usdOff}
                </span>
              </>
            ) : (
              <span className="flex items-center gap-1 text-salmon">
                <X aria-hidden className="size-4" />
                Unrecognized code
              </span>
            )}
          </p>

          <Button
            type="submit"
            disabled={busy}
            className="h-12 w-full text-base"
          >
            {busy ? "Opening checkout…" : "Continue to checkout"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
