// Shared half of the promo-code tool (/backstage/promo): the mint contract used
// by promo-codes-stripe.ts.

export const PURPOSES = [
  "Speaker",
  "Volunteer",
  "Staff",
  "Sponsor",
  "Press",
  "Financial aid",
  "Friend/Family",
  "Easter Egg",
  "Flyer",
] as const;

export const PROMO_SOURCE = "comp-tool";

/** What a custom code may be spelled with. */
export const CUSTOM_CODE_RE = /^[A-Za-z0-9-]+$/;

export type MintInput = {
  name: string;
  email?: string;
  customCode?: string;
  /** null = unlimited; a positive integer = that cap; anything else = 1. */
  maxUses: number | null;
  purpose: string;
  notes?: string;
};

/** Who an existing code was originally issued to, so a re-run can say so. */
export type Prior = {
  name: string;
  email: string;
  purpose: string;
  created: number | null; // unix seconds
  redeemed?: number;
};

export type MintResult = {
  /** The Stripe promotion code's id (promo_…). */
  id: string;
  code: string;
  active: boolean;
  couponId: string;
  name: string;
  email: string;
  reused: boolean;
  prior?: Prior;
  max: number | null;
  purpose: string;
  test: boolean;
};

export class PromoError extends Error {
  constructor(
    message: string,
    readonly code: "collision" | "exhausted" | "config",
  ) {
    super(message);
  }
}

export function normalizeName(name: string | undefined): string {
  const n = (name ?? "").trim();
  if (!n)
    throw new Error(
      "Enter a name (or pseudonym / group) for who this code is for",
    );
  return n;
}

export function normalizePurpose(purpose: string | undefined): string {
  const p = (purpose ?? "").trim();
  if (!p) throw new Error("Pick a purpose (or type a custom one)");
  return p;
}

/** Clamp to an integer cap ≥ 1; null stays null (unlimited). */
export function normalizeUses(
  maxUses: number | null | undefined,
): number | null {
  if (maxUses === null) return null;
  return Math.max(1, Math.floor(Number(maxUses) || 1));
}

const LEGACY_SLUG_LEN = 5; // chars after "COMP-"
export const MAX_SLUG_ATTEMPTS = 10;

/**
 * The unkeyed scheme codes were once minted with. Only kept to find a code
 * already issued to someone, so a re-run returns it rather than a second one.
 */
export function legacySlugCode(seed: string, attempt = 0): string {
  const base = seed.trim().toLowerCase() + (attempt ? `#${attempt}` : "");
  let h = 0;
  for (let i = 0; i < base.length; i++) h = (h * 31 + base.charCodeAt(i)) >>> 0;
  return (
    "COMP-" +
    (h % 36 ** LEGACY_SLUG_LEN)
      .toString(36)
      .toUpperCase()
      .padStart(LEGACY_SLUG_LEN, "0")
  );
}

/** The identity a code was issued to. */
export const identityOf = ({
  email,
  name,
}: {
  email?: string | null;
  name?: string | null;
}) => (email || name || "").trim().toLowerCase();

export const seedOf = ({ email, name }: { email?: string; name: string }) =>
  (email || name).trim();

export const normalizeCustomCode = (code: string | undefined) =>
  (code ?? "").trim().toUpperCase();
