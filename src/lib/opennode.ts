import crypto from "node:crypto";
import { fetchWithin } from "@/lib/fetch-timeout";

// OpenNode integration with no SDK — just fetch + node crypto. The 2025 site used
// the `opennode` npm package but it dragged in a lot for two endpoints; a thin
// wrapper is clearer and easier to keep typed against the v1 REST shapes we use.

// The one switch for creating new Bitcoin charges. Off since the 2026 tickets
// came down; the status and webhook routes stay up for charges already made.
export const BTC_CHECKOUT_OPEN: boolean = false;

type OpenNodeEnv = "live" | "dev";

const openNodeFetch = fetchWithin(10_000);

function getEnv(): OpenNodeEnv {
  return process.env.OPENNODE_ENV === "live" ? "live" : "dev";
}

function getKey(): string {
  const key = process.env.OPENNODE_KEY;
  if (!key) {
    // In production (live) a missing key is a misconfiguration, not an expected
    // dev state — fail loudly so it surfaces instead of silently degrading.
    if (getEnv() === "live") {
      throw new Error(
        "OPENNODE_KEY is not set but OPENNODE_ENV=live — refusing to handle live Bitcoin payments without it",
      );
    }
    throw new Error("OPENNODE_KEY is not set");
  }
  return key;
}

// OpenNode charge ids are UUID v4 (hex with dashes). Validate before using one
// in a URL path or trusting it from a client/query param.
const CHARGE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidChargeId(id: string): boolean {
  return CHARGE_ID_RE.test(id);
}

function getBaseUrl(): string {
  return getEnv() === "live"
    ? "https://api.opennode.com"
    : "https://dev-api.opennode.com";
}

/** The bits of an OpenNode charge we care about. The API returns more. */
export type OpenNodeCharge = {
  id: string;
  status: string;
  amount: number;
  order_id?: string;
  fee?: number;
  fiat_value?: number;
  hosted_checkout_url?: string;
  metadata?: Record<string, unknown>;
  transactions?: Array<{
    tx?: string;
    address?: string;
    amount?: number;
    settled_at?: number | string;
    status?: string;
  }>;
  [key: string]: unknown;
};

export type CreateChargeInput = {
  amountSats: number;
  description: string;
  customerEmail?: string;
  orderId: string;
  metadata?: Record<string, unknown>;
  callbackUrl: string;
  successUrl: string;
};

/** Unwrap OpenNode's `{ data: ... }` envelope, tolerating a bare body. */
function unwrap(json: unknown): OpenNodeCharge {
  if (json && typeof json === "object" && "data" in json) {
    return (json as { data: OpenNodeCharge }).data;
  }
  return json as OpenNodeCharge;
}

export async function createCharge(
  input: CreateChargeInput,
): Promise<OpenNodeCharge> {
  const res = await openNodeFetch(`${getBaseUrl()}/v1/charges`, {
    method: "POST",
    headers: {
      Authorization: getKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: input.amountSats,
      currency: "BTC",
      description: input.description,
      customer_email: input.customerEmail,
      order_id: input.orderId,
      metadata: input.metadata,
      callback_url: input.callbackUrl,
      success_url: input.successUrl,
      auto_settle: true,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `OpenNode createCharge failed (${res.status}): ${text.slice(0, 500)}`,
    );
  }
  return unwrap(text ? JSON.parse(text) : null);
}

export async function getCharge(id: string): Promise<OpenNodeCharge> {
  if (!isValidChargeId(id)) {
    throw new Error("Invalid OpenNode charge id");
  }
  const res = await openNodeFetch(
    `${getBaseUrl()}/v1/charge/${encodeURIComponent(id)}`,
    {
      headers: { Authorization: getKey() },
    },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `OpenNode getCharge failed (${res.status}): ${text.slice(0, 500)}`,
    );
  }
  return unwrap(text ? JSON.parse(text) : null);
}

/**
 * Verify an OpenNode webhook: `hashed_order` must equal
 * HMAC_SHA256(message=charge id, key=OPENNODE_KEY) in hex. Constant-time compare.
 */
export function verifyWebhookSignature({
  id,
  hashed_order,
}: {
  id: string;
  hashed_order: string;
}): boolean {
  const expected = crypto
    .createHmac("sha256", getKey())
    .update(id)
    .digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(hashed_order, "utf8");
  // timingSafeEqual throws on length mismatch — guard so it returns false instead.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** True if `url` is an OpenNode checkout host (and https). */
export function isOpenNodeCheckoutUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  return (
    host === "checkout.opennode.com" ||
    host === "checkout.dev.opennode.com" ||
    host.endsWith(".opennode.com")
  );
}

/**
 * Hosted checkout URL: prefer the charge's own, else derive from the id. The
 * charge's URL is only used if it validates as an OpenNode host — otherwise we
 * fall back to the safe derived URL so we never redirect to an arbitrary host.
 */
export function getHostedCheckoutUrl(
  chargeId: string,
  charge?: OpenNodeCharge,
): string {
  if (
    charge?.hosted_checkout_url &&
    isOpenNodeCheckoutUrl(charge.hosted_checkout_url)
  ) {
    return charge.hosted_checkout_url;
  }
  const sub = getEnv() === "live" ? "" : ".dev";
  return `https://checkout${sub}.opennode.com/${encodeURIComponent(chargeId)}`;
}
