"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { captureUtm, stripUtmFromUrl } from "@/lib/utm";

export default function UtmCapture() {
  useEffect(() => {
    const promo = captureUtm(window.location.search);
    stripUtmFromUrl();
    // Not checked against Stripe here; the discount modal does that at checkout.
    if (promo) toast(`Promo code “${promo.toUpperCase()}” saved from link`);
  }, []);
  return null;
}
