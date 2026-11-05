import { env } from "@/env";
import { airtableConfig } from "@/lib/airtable-config";
import { cleanDiscordHandle } from "@/lib/discord-handle";
import { EMAIL_LIST_VALUE, type InterestValue } from "@/lib/interests";
import type { Utm } from "@/lib/utm";
import type { EggEvent } from "@/v2/components/dividers/track";

export type SignupResult = { stored: boolean; reason?: string };

// Interest Intake tags each row by Type of Interest; every splash signup gets the
// "email list" option. Written by name (the API rejects option ids on write); typecast
// keeps signups working if it's relabeled — but update this to match, or a stray option
// gets recreated.
const INTEREST_FIELD = "Type of Interest";

// Interest Intake's primary field. Optional on the form, so only sent when provided
// (avoids overwriting an existing name with a blank on a repeat submit).
const NAME_FIELD = "Name";
// Free-text "anything else" from the follow-up form.
const NOTES_FIELD = "Notes";
// Marks dev/test submissions so they're filterable from real signups.
const TEST_FIELD = "Test";
const UNSUBSCRIBE_FIELD = "Unsubscribe";

type SignupFields = {
  name?: string;
  interests?: InterestValue[];
  notes?: string;
  test?: boolean; // force the Test box, e.g. a sandbox purchase hitting prod
};

/**
 * Upsert an email into the Airtable signups table, keyed on the email field so
 * a repeat submission updates rather than duplicates.
 *
 * Both the initial signup and the optional interest follow-up call this, as
 * does the post-purchase opt-in. An upsert PATCH *replaces* the multi-select,
 * so the row's existing interests are read first and unioned in — a repeat
 * signup only ever adds tags.
 *
 * If Airtable isn't configured yet (no token / base / table), this no-ops with
 * a warning so local dev still works — the splash form succeeds, the email just
 * isn't persisted.
 */
export async function recordSignup(
  email: string,
  { name, interests = [], notes, test = false }: SignupFields = {},
): Promise<SignupResult> {
  const { AIRTABLE_API_KEY } = env;

  if (!AIRTABLE_API_KEY) {
    console.warn(`[signup] Airtable not configured — not stored: ${email}`);
    return { stored: false, reason: "airtable-not-configured" };
  }

  const tableUrl = `https://api.airtable.com/v0/${airtableConfig.baseId}/${encodeURIComponent(airtableConfig.signupsTableId)}`;

  const existing = await existingInterests(tableUrl, email, AIRTABLE_API_KEY);

  const fields: Record<string, unknown> = {
    [airtableConfig.signupEmailField]: email,
    [INTEREST_FIELD]: Array.from(
      new Set([EMAIL_LIST_VALUE, ...existing, ...interests]),
    ),
    // VERCEL_ENV distinguishes preview from production (NODE_ENV is "production"
    // for both), so preview deploys + local dev (undefined) are marked test.
    [TEST_FIELD]: test || process.env.VERCEL_ENV !== "production",
  };
  if (name) fields[NAME_FIELD] = name;
  if (notes) fields[NOTES_FIELD] = notes;

  const res = await fetch(tableUrl, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      performUpsert: { fieldsToMergeOn: [airtableConfig.signupEmailField] },
      records: [{ fields }],
      typecast: true,
    }),
  });

  if (!res.ok) {
    throw new Error(`Airtable responded ${res.status}: ${await res.text()}`);
  }

  return { stored: true };
}

/**
 * When an email first landed on the signups table, or null if it never has.
 * Case-insensitive, and counts unsubscribed rows — ticket purchases use this to
 * leave anyone who's already been on the list alone.
 */
export async function signupCreatedAt(email: string): Promise<Date | null> {
  const { AIRTABLE_API_KEY } = env;
  if (!AIRTABLE_API_KEY) return null;

  const literal = email
    .trim()
    .toLowerCase()
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
  const query = new URLSearchParams({
    filterByFormula: `LOWER(TRIM({${airtableConfig.signupEmailField}}))='${literal}'`,
  });
  query.append("fields[]", airtableConfig.signupEmailField);
  const res = await fetch(
    `https://api.airtable.com/v0/${airtableConfig.baseId}/${encodeURIComponent(airtableConfig.signupsTableId)}?${query}`,
    { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } },
  );
  if (!res.ok) {
    throw new Error(`Airtable responded ${res.status}: ${await res.text()}`);
  }
  const { records = [] } = (await res.json()) as {
    records?: { createdTime: string }[];
  };
  if (records.length === 0) return null;
  return new Date(Math.min(...records.map((r) => Date.parse(r.createdTime))));
}

/**
 * Tick Unsubscribe on an email's signup row. An upsert that sends only this
 * field, so it leaves the rest of the row alone, and creates the row if the
 * purchase webhook hasn't added the buyer yet — that later upsert never sends
 * Unsubscribe, so the opt-out sticks in either order.
 */
export async function unsubscribeSignup(
  email: string,
  { test = false }: { test?: boolean } = {},
): Promise<SignupResult> {
  const { AIRTABLE_API_KEY } = env;

  if (!AIRTABLE_API_KEY) {
    console.warn(`[opt-out] Airtable not configured — not stored: ${email}`);
    return { stored: false, reason: "airtable-not-configured" };
  }

  const res = await fetch(
    `https://api.airtable.com/v0/${airtableConfig.baseId}/${encodeURIComponent(airtableConfig.signupsTableId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        performUpsert: { fieldsToMergeOn: [airtableConfig.signupEmailField] },
        records: [
          {
            fields: {
              [airtableConfig.signupEmailField]: email,
              [UNSUBSCRIBE_FIELD]: true,
              ...(test || process.env.VERCEL_ENV !== "production"
                ? { [TEST_FIELD]: true }
                : {}),
            },
          },
        ],
        typecast: true,
      }),
    },
  );

  if (!res.ok) {
    throw new Error(`Airtable responded ${res.status}: ${await res.text()}`);
  }

  return { stored: true };
}

// Throws on a failed read rather than returning [] — writing without the
// existing tags is exactly the overwrite this guards against.
async function existingInterests(
  tableUrl: string,
  email: string,
  apiKey: string,
): Promise<string[]> {
  const literal = email.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const query = new URLSearchParams({
    filterByFormula: `{${airtableConfig.signupEmailField}}='${literal}'`,
  });
  query.append("fields[]", INTEREST_FIELD);
  const res = await fetch(`${tableUrl}?${query}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`Airtable responded ${res.status}: ${await res.text()}`);
  }
  const { records = [] } = (await res.json()) as {
    records?: { fields: Record<string, unknown> }[];
  };
  return records.flatMap((r) => {
    const value = r.fields[INTEREST_FIELD];
    return Array.isArray(value) ? (value as string[]) : [];
  });
}

/**
 * Flip an already-recorded purchase to Failed, keyed on the payment id (= the
 * upsert key recordPurchase uses). No-ops when no row exists yet — a charge that
 * never reached `processing` was never recorded and so never counted as a
 * redemption, leaving nothing to heal. Idempotent: re-running just re-sets Failed.
 * Updates by record id (not an upsert) so it can never create a row.
 */
export async function markPurchaseFailedIfExists(
  paymentId: string,
): Promise<boolean> {
  const { AIRTABLE_API_KEY } = env;
  if (!AIRTABLE_API_KEY) {
    console.warn(
      `[purchase] Airtable not configured — cannot mark failed: ${paymentId}`,
    );
    return false;
  }

  // OpenNode charge ids are hex + dashes; strip anything else to neutralize
  // filterByFormula injection.
  const safe = paymentId.replace(/[^0-9a-fA-F-]/g, "");
  if (!safe) return false;

  const tableUrl = `https://api.airtable.com/v0/${airtableConfig.baseId}/${encodeURIComponent(airtableConfig.purchasesTableId)}`;

  const findRes = await fetch(
    `${tableUrl}?filterByFormula=${encodeURIComponent(`{ID}='${safe}'`)}&maxRecords=1`,
    { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } },
  );
  if (!findRes.ok) {
    throw new Error(
      `Airtable responded ${findRes.status}: ${await findRes.text()}`,
    );
  }
  const found = (await findRes.json()) as { records?: { id: string }[] };
  const recordId = found.records?.[0]?.id;
  if (!recordId) return false;

  const failed: PurchaseStatus = "Failed";
  const patchRes = await fetch(tableUrl, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      records: [{ id: recordId, fields: { Status: failed } }],
    }),
  });
  if (!patchRes.ok) {
    throw new Error(
      `Airtable responded ${patchRes.status}: ${await patchRes.text()}`,
    );
  }
  return true;
}

/**
 * Point a purchase row at its ticket's new code, matched on ID (= the ticket's
 * payment id, `<intent>:ticket:<n>` for pack admissions). Updates by record
 * id, so it never creates a row; admin-issued tickets have none.
 */
export async function updatePurchaseTicketCode(
  paymentId: string,
  code: string,
): Promise<boolean> {
  const { AIRTABLE_API_KEY } = env;
  if (!AIRTABLE_API_KEY) {
    console.warn(
      `[purchase] Airtable not configured — ticket code not updated: ${paymentId}`,
    );
    return false;
  }

  const safe = paymentId.replace(/[^0-9A-Za-z_:-]/g, "");
  if (!safe) return false;

  const tableUrl = `https://api.airtable.com/v0/${airtableConfig.baseId}/${encodeURIComponent(airtableConfig.purchasesTableId)}`;
  const findRes = await fetch(
    `${tableUrl}?filterByFormula=${encodeURIComponent(`{ID}='${safe}'`)}&maxRecords=1`,
    { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } },
  );
  if (!findRes.ok) {
    throw new Error(
      `Airtable responded ${findRes.status}: ${await findRes.text()}`,
    );
  }
  const found = (await findRes.json()) as { records?: { id: string }[] };
  const recordId = found.records?.[0]?.id;
  if (!recordId) return false;

  const patchRes = await fetch(tableUrl, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      records: [{ id: recordId, fields: { "Ticket Code": code } }],
    }),
  });
  if (!patchRes.ok) {
    throw new Error(
      `Airtable responded ${patchRes.status}: ${await patchRes.text()}`,
    );
  }
  return true;
}

// Lifecycle of a purchase. Card → Paid instantly; ACH bank debits land Pending
// then settle to Paid (or bounce to Failed) days later. BTC charges land Pending
// (on-chain processing) then settle to Paid, or land Underpaid. "Underpaid" is a
// new singleSelect option auto-created by the upsert's typecast.
export type PurchaseStatus = "Pending" | "Paid" | "Failed" | "Underpaid";

export type PurchaseRecord = {
  id: string; // payment id (Stripe payment / OpenNode charge) — the upsert key, so redelivered events dedupe
  status: PurchaseStatus;
  test: boolean; // true for test-mode (sandbox) purchases — checks the Test box
  paymentMethod: "stripe" | "btc";
  customerName?: string;
  preferredName?: string; // optional "Preferred name" custom field from the Payment Link checkout
  customerEmail?: string;
  amount?: number; // dollars (Airtable currency field)
  btcAmount?: number; // whole BTC paid (only set for BTC purchases)
  fee?: number;
  net?: number;
  billingName?: string;
  billingEmail?: string;
  ticketType?: string;
  ticketCode?: string; // the ticket's current code: derived from the id until an unclaim reissues it
  couponCode?: string; // promotion code the buyer used, e.g. "EARLYBIRD"
  amountDiscount?: number; // dollars knocked off by the coupon
  btcAmountDiscounted?: number; // whole BTC knocked off by a BTC discount code
  receiptUrl?: string;
  notes?: string;
  discordHandle?: string; // Discord Username custom field from the Payment Link checkout
  openNodeOrderId?: string;
  btcTxId?: string;
  hostedCheckoutUrl?: string;
  networkFeeBtc?: number;
  settledFiatValue?: number;
  btcNetwork?: "On-chain" | "Lightning";
  utm?: Utm; // last-touch attribution: latest landing UTMs, first visit, PostHog ids
};

/**
 * Upsert a ticket purchase into the Airtable "Stripe Purchases" table, keyed on
 * the Stripe payment id so Stripe's at-least-once webhook redelivery can't create
 * duplicate rows. No-ops with a warning when Airtable isn't configured, mirroring
 * recordSignup. Only fields we actually have are sent, so blanks never clobber.
 */
export async function recordPurchase(
  purchase: PurchaseRecord,
): Promise<SignupResult> {
  const { AIRTABLE_API_KEY } = env;

  if (!AIRTABLE_API_KEY) {
    console.warn(
      `[purchase] Airtable not configured — not stored: ${purchase.id}`,
    );
    return { stored: false, reason: "airtable-not-configured" };
  }

  const fields: Record<string, unknown> = {
    ID: purchase.id,
    Status: purchase.status,
    Test: purchase.test,
    "Payment Method": purchase.paymentMethod === "btc" ? "BTC" : "Stripe",
  };
  if (purchase.btcAmount != null) fields["BTC Amount"] = purchase.btcAmount;
  if (purchase.customerName) fields["Customer Name"] = purchase.customerName;
  if (purchase.preferredName) fields["Preferred Name"] = purchase.preferredName;
  if (purchase.customerEmail) fields["Customer Email"] = purchase.customerEmail;
  if (purchase.amount != null) fields["Amount"] = purchase.amount;
  if (purchase.fee != null) fields["Balance Transaction Fee"] = purchase.fee;
  if (purchase.net != null) fields["Balance Transaction Net"] = purchase.net;
  if (purchase.billingName)
    fields["Billing Details Name"] = purchase.billingName;
  if (purchase.billingEmail)
    fields["Billing Details Email"] = purchase.billingEmail;
  if (purchase.ticketType) fields["Ticket Type"] = purchase.ticketType;
  if (purchase.ticketCode) fields["Ticket Code"] = purchase.ticketCode;
  if (purchase.couponCode) fields["Coupon Code"] = purchase.couponCode;
  if (purchase.amountDiscount != null)
    fields["Amount Discounted"] = purchase.amountDiscount;
  if (purchase.btcAmountDiscounted != null && purchase.btcAmountDiscounted > 0)
    fields["BTC Amount Discounted"] = purchase.btcAmountDiscounted;
  if (purchase.receiptUrl) fields["Receipt URL"] = purchase.receiptUrl;
  if (purchase.notes) fields["Notes"] = purchase.notes;
  const discordHandle = cleanDiscordHandle(purchase.discordHandle);
  if (discordHandle) fields["Discord Handle"] = discordHandle;
  if (purchase.openNodeOrderId)
    fields["OpenNode Order ID"] = purchase.openNodeOrderId;
  if (purchase.btcTxId) fields["BTC Tx ID"] = purchase.btcTxId;
  if (purchase.hostedCheckoutUrl)
    fields["Hosted Checkout URL"] = purchase.hostedCheckoutUrl;
  if (purchase.networkFeeBtc != null)
    fields["Network Fee (BTC)"] = purchase.networkFeeBtc;
  if (purchase.settledFiatValue != null)
    fields["Settled Fiat Value"] = purchase.settledFiatValue;
  if (purchase.btcNetwork) fields["BTC Network"] = purchase.btcNetwork;
  if (purchase.utm?.utm_source) fields["UTM Source"] = purchase.utm.utm_source;
  if (purchase.utm?.utm_medium) fields["UTM Medium"] = purchase.utm.utm_medium;
  if (purchase.utm?.utm_campaign)
    fields["UTM Campaign"] = purchase.utm.utm_campaign;
  if (purchase.utm?.utm_content)
    fields["UTM Content"] = purchase.utm.utm_content;
  if (purchase.utm?.utm_term) fields["UTM Term"] = purchase.utm.utm_term;
  if (purchase.utm?.first_visit)
    fields["First Visit"] = purchase.utm.first_visit;
  if (purchase.utm?.posthog_id) fields["PostHog ID"] = purchase.utm.posthog_id;

  const res = await fetch(
    `https://api.airtable.com/v0/${airtableConfig.baseId}/${encodeURIComponent(airtableConfig.purchasesTableId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        performUpsert: { fieldsToMergeOn: ["ID"] },
        records: [{ fields }],
        typecast: true,
      }),
    },
  );

  if (!res.ok) {
    throw new Error(`Airtable responded ${res.status}: ${await res.text()}`);
  }

  return { stored: true };
}

// ── META Cryptic Clues ───────────────────────────────────────────────────────
// Field names in the "META Cryptic Clues" table. Written by name, like the rest.
const CLUE_FIELD = "Cryptic clue";
const CLUE_NAME_FIELD = "Name";
const CLUE_EMAIL_FIELD = "Email";

export type ClueResult = { stored: boolean; id?: string; reason?: string };

function cluesUrl(recordId?: string) {
  const base = `https://api.airtable.com/v0/${airtableConfig.baseId}/${encodeURIComponent(airtableConfig.crypticCluesTableId)}`;
  return recordId ? `${base}/${recordId}` : base;
}

/**
 * Create a row for a submitted clue and return its record id, so the optional
 * name/email follow-up can attach to the same row. No-ops (with a warning)
 * when Airtable isn't configured, mirroring recordSignup.
 */
export async function recordCrypticClue(clue: string): Promise<ClueResult> {
  const { AIRTABLE_API_KEY } = env;
  if (!AIRTABLE_API_KEY) {
    console.warn(`[clue] Airtable not configured — not stored: ${clue}`);
    return { stored: false, reason: "airtable-not-configured" };
  }

  const res = await fetch(cluesUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: { [CLUE_FIELD]: clue } }),
  });
  if (!res.ok) {
    throw new Error(`Airtable responded ${res.status}: ${await res.text()}`);
  }
  const { id } = (await res.json()) as { id: string };
  return { stored: true, id };
}

/**
 * Attach a name and/or email to an already-submitted clue. Updates by record
 * id and only ever touches the two contact fields, so it can't create rows or
 * overwrite a clue.
 */
export async function addCrypticClueContact(
  recordId: string,
  { name, email }: { name?: string; email?: string },
): Promise<ClueResult> {
  const { AIRTABLE_API_KEY } = env;
  if (!AIRTABLE_API_KEY) {
    console.warn(`[clue] Airtable not configured — contact not stored`);
    return { stored: false, reason: "airtable-not-configured" };
  }

  const fields: Record<string, string> = {};
  if (name) fields[CLUE_NAME_FIELD] = name;
  if (email) fields[CLUE_EMAIL_FIELD] = email;

  const res = await fetch(cluesUrl(recordId), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    throw new Error(`Airtable responded ${res.status}: ${await res.text()}`);
  }
  return { stored: true, id: recordId };
}

export type DiscountCodeRecord = {
  code: string;
  active: boolean;
  test: boolean; // true for test-mode (sandbox) codes — checks the Test box
  maxUses: number | null; // redemption cap; null clears the field (uncapped)
  expiresAt: string | null; // ISO instant the code stops working; null clears (never)
  percentOff?: number; // e.g. 100 = 100% off
  usdOff?: number; // dollars off (Airtable currency field)
  redeemed?: number; // mirror of the promo's times_redeemed (Stripe stays source of truth)
  email?: string;
  label?: string;
  purpose?: string; // comp category from the comp tool (Purpose single-select; typecast adds new options)
  notes?: string; // operator's free-text note from the comp tool (Comp Notes)
  issuedBy?: string; // backstage admin who minted the code (Issued By)
};

/**
 * Mirror a Stripe promotion code into the Airtable "Discount Codes" table as a
 * Method=Stripe row, so every code (Stripe + BTC) lives in one table. The
 * stripe-webhook is the sole writer of Method=Stripe rows. No-ops with a warning
 * when Airtable isn't configured, mirroring recordPurchase.
 */
export async function recordDiscountCode(
  record: DiscountCodeRecord,
): Promise<SignupResult> {
  const { AIRTABLE_API_KEY } = env;

  if (!AIRTABLE_API_KEY) {
    console.warn(
      `[discount] Airtable not configured — not stored: ${record.code}`,
    );
    return { stored: false, reason: "airtable-not-configured" };
  }

  const fields: Record<string, unknown> = {
    Code: record.code.toUpperCase(),
    Method: "Stripe",
    Active: record.active,
    Archived: !record.active,
    Test: record.test,
    // Explicit null clears a stale cap when the promo is uncapped (omitting would keep it).
    "Max Uses": record.maxUses,
    Expires: record.expiresAt,
    Notes: "Stripe promo (stripe-webhook)",
  };
  // Exactly one per-unit column is populated per code (the other stays blank).
  if (record.percentOff != null) fields["Percent Off"] = record.percentOff;
  if (record.usdOff != null) fields["USD Off"] = record.usdOff;
  if (record.redeemed != null) fields["Stripe Redeemed"] = record.redeemed;
  // Only set Email/Label when present so a repeat event can't blank an existing value.
  if (record.email) fields.Email = record.email;
  if (record.label) fields.Label = record.label;
  if (record.purpose) fields.Purpose = record.purpose;
  if (record.notes) fields["Comp Notes"] = record.notes;
  if (record.issuedBy) fields["Issued By"] = record.issuedBy;

  const res = await fetch(
    `https://api.airtable.com/v0/${airtableConfig.baseId}/${encodeURIComponent(airtableConfig.discountCodesTableId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Code+Method, not Code alone: a deterministic comp code can also exist as a
        // Method=BTC row, and merging on Code would clobber it.
        performUpsert: { fieldsToMergeOn: ["Code", "Method"] },
        records: [{ fields }],
        typecast: true,
      }),
    },
  );

  if (!res.ok) {
    throw new Error(`Airtable responded ${res.status}: ${await res.text()}`);
  }

  return { stored: true };
}

/**
 * One row in Egg Tracking. A `clicks` event is upserted — one row per visit per
 * egg, overwritten with the running total — and everything else is appended, so
 * Airtable does the counting. No-ops without a token, like the rest.
 */
export async function recordEgg(found: EggEvent, visit: string): Promise<void> {
  const { AIRTABLE_API_KEY } = env;
  if (!AIRTABLE_API_KEY) return;

  const upsert = found.event === "clicks";
  const res = await fetch(
    `https://api.airtable.com/v0/${airtableConfig.baseId}/${airtableConfig.eggTrackingTableId}`,
    {
      method: upsert ? "PATCH" : "POST",
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(upsert && {
          performUpsert: { fieldsToMergeOn: ["Visit", "Egg", "Event"] },
        }),
        // Egg and Event are single-selects: a new egg adds its own options.
        // Safe on a public endpoint because /api/egg allow-lists both.
        typecast: true,
        records: [
          {
            fields: {
              Egg: found.egg,
              Event: found.event,
              ...(found.event === "cast" && {
                Word: found.word,
                "Word via": found.via,
              }),
              ...(found.event === "clicks" && { Clicks: found.clicks }),
              Visit: visit,
              When: new Date().toISOString(),
              [TEST_FIELD]: process.env.VERCEL_ENV !== "production",
            },
          },
        ],
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`Airtable responded ${res.status}: ${await res.text()}`);
  }
}
