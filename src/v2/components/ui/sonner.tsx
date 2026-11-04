"use client";

import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      position="top-center"
      richColors
      // An open Radix dialog sets pointer-events: none on the body.
      toastOptions={{
        className: "pointer-events-auto font-[family-name:var(--font-inter)]",
      }}
    />
  );
}
