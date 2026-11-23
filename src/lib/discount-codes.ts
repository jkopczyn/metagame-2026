import { env } from "@/env";
import { airtableConfig, airtableFetch } from "@/lib/airtable-config";
import { ticketTiers } from "@/lib/tickets";

// Full BTC price of the standard ticket; discounts are resolved relative to it.
const FULL_BTC =
  ticketTiers.find((t) => t.id === "standard")?.prices.full.btc ?? 0.0065;

export type DiscountLookup =
  | {
      status: "valid";
      code: string;
      btcPrice: number; // the discounted BTC price this code charges
      label?: string;
      maxUses: number | null; // redemption cap; null when the Airtable field is blank (unlimited)
    }
  // A sandbox-minted (Test) code entered against live OpenNode. Valid for exercising
  // the flow on testnet, but never honored in live — callers refuse it outright.
  | { status: "test" }
  | { status: "none" };

/**
 * Look up an active discount code in the Airtable "Discount Codes" table — the
 * ground truth for what a code charges. Returns "none" for an unknown/inactive code,
 * an unconfigured Airtable, or any failure, so the caller falls back to full price;
 * "test" for a sandbox code seen in live. Never throws into the request path: a bad
 * code only ever charges *full*, not less.
 */
export async function lookupDiscountCode(
  code: string,
): Promise<DiscountLookup> {
  const { AIRTABLE_API_KEY } = env;
  if (!AIRTABLE_API_KEY) return { status: "none" };

  // Uppercase + strip to [A-Z0-9_-]. This both normalizes to the stored form and
  // neutralizes filterByFormula injection (no quotes/parens survive sanitizing).
  const safe = code.toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  if (!safe) return { status: "none" };

  // Method=Stripe rows live in this table for logging only (mirrored by the
  // stripe-webhook) and must never be honored as BTC discounts; blank Method
  // (legacy/manual codes like EARLYBIRD) is still honored.
  const formula = `AND(UPPER({Code})='${safe}',{Active},{Method}!='Stripe')`;
  const url =
    `https://api.airtable.com/v0/${airtableConfig.baseId}/${encodeURIComponent(airtableConfig.discountCodesTableId)}` +
    `?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;

  try {
    const res = await airtableFetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
    });
    if (!res.ok) {
      console.warn(`[discount] Airtable responded ${res.status}`);
      return { status: "none" };
    }
    const data = (await res.json()) as {
      records?: { fields?: Record<string, unknown> }[];
    };
    const fields = data.records?.[0]?.fields;
    if (!fields) return { status: "none" };

    // Blank Expires = never. Compared here rather than in the formula so an
    // unparseable value fails closed (treated as expired) instead of silently passing.
    const expires = fields["Expires"];
    if (expires != null && expires !== "") {
      const at = Date.parse(String(expires));
      if (!Number.isFinite(at) || at <= Date.now()) return { status: "none" };
    }

    // New per-unit columns: exactly one is populated. BTC Off is a flat BTC
    // subtraction (a fixed price is expressed as its equivalent); Percent Off is %.
    const btcOffRaw = Number(fields["BTC Off"]);
    const percentOffRaw = Number(fields["Percent Off"]);
    const btcOff = Number.isFinite(btcOffRaw) ? btcOffRaw : null;
    const percentOff = Number.isFinite(percentOffRaw) ? percentOffRaw : null;

    let price: number;
    if (btcOff != null) {
      price = FULL_BTC - btcOff;
    } else if (percentOff != null) {
      price = FULL_BTC * (1 - percentOff / 100);
    } else {
      // Legacy fallback for un-migrated rows on the old Discount Type/Value columns.
      const discountType = fields["Discount Type"];
      const value = Number(fields["Value"]);
      if (typeof discountType !== "string" || !Number.isFinite(value))
        return { status: "none" };
      switch (discountType) {
        case "End price":
          price = value;
          break;
        case "Amount off":
          price = FULL_BTC - value;
          break;
        case "Percent off":
          price = FULL_BTC * (1 - value / 100);
          break;
        default:
          return { status: "none" };
      }
    }

    // Round to whole-satoshi precision so percent/amount math displays cleanly.
    const btcPrice = Math.round(price * 1e8) / 1e8;
    // A discount can only lower the price within (0, full]; anything else is invalid.
    if (!Number.isFinite(btcPrice) || btcPrice <= 0 || btcPrice > FULL_BTC) {
      return { status: "none" };
    }

    // Test codes are sandbox artifacts that share this table with live codes. They
    // stay usable when OpenNode itself is in sandbox (dev = testnet) so we can verify
    // codes end-to-end, but in live they must never discount a real charge.
    if (Boolean(fields["Test"]) && process.env.OPENNODE_ENV === "live") {
      return { status: "test" };
    }

    const label = fields["Label"];
    const maxUsesRaw = fields["Max Uses"];
    // Blank Airtable number field comes back absent → null → unlimited.
    const maxUses =
      typeof maxUsesRaw === "number" && Number.isFinite(maxUsesRaw)
        ? maxUsesRaw
        : null;
    return {
      status: "valid",
      code: safe,
      btcPrice,
      label: typeof label === "string" && label ? label : undefined,
      maxUses,
    };
  } catch (err) {
    console.warn("[discount] lookup failed:", err);
    return { status: "none" };
  }
}

/**
 * Count committed BTC redemptions of a code in the "Stripe Purchases" ledger.
 * Pending + Paid + Underpaid all count (any committed payment); only an explicit
 * Failed is excluded. An abandoned/expired charge never created a purchase row,
 * so it never counts — which is why a redemption cap needs no decrement anywhere.
 * Fail-soft (returns the best-effort count, never throws) like lookupDiscountCode.
 */
export async function countCodeRedemptions(code: string): Promise<number> {
  const { AIRTABLE_API_KEY } = env;
  if (!AIRTABLE_API_KEY) return 0;

  // Same sanitizing as lookupDiscountCode: normalize to the stored form and
  // neutralize filterByFormula injection.
  const safe = code.toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  if (!safe) return 0;

  const formula = `AND(UPPER({Coupon Code})='${safe}',{Payment Method}='BTC',{Status}!='Failed')`;
  const base =
    `https://api.airtable.com/v0/${airtableConfig.baseId}/` +
    encodeURIComponent(airtableConfig.purchasesTableId);

  let count = 0;
  let offset: string | undefined;
  try {
    do {
      const params = new URLSearchParams({ filterByFormula: formula });
      if (offset) params.set("offset", offset);
      const res = await airtableFetch(`${base}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
      });
      if (!res.ok) {
        console.warn(`[discount] redemption count responded ${res.status}`);
        return count;
      }
      const data = (await res.json()) as {
        records?: unknown[];
        offset?: string;
      };
      count += data.records?.length ?? 0;
      offset = data.offset;
    } while (offset);
  } catch (err) {
    console.warn("[discount] redemption count failed:", err);
  }
  return count;
}
