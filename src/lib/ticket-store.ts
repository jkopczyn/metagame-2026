import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { getDb, schema } from "@/db";
import { env } from "@/env";
import {
  updatePurchaseTicketCode,
  type PurchaseRecord,
  type PurchaseStatus,
} from "@/lib/airtable";
import { cleanDiscordHandle } from "@/lib/discord-handle";
import { sendAdminErrorEmail } from "@/lib/email";
import { isBadgeCode } from "@/lib/badge-code";
import {
  isUniqueViolation,
  ticketCode,
  withFreshTicketCode,
} from "@/lib/ticket-code";
import { emailKey } from "@/lib/ticket-holder";
import {
  EVENT_YEAR,
  getDayPass,
  getTicket,
  supporterTier,
  ticketYear,
} from "@/lib/tickets";

export { normalizeTicketCode } from "@/lib/ticket-code-format";
export { emailKey, holdsTicket } from "@/lib/ticket-holder";

type Ticket = typeof schema.tickets.$inferInsert;
export type TicketRow = typeof schema.tickets.$inferSelect;

const { tickets, verification } = schema;

// Sandbox purchases land in the same table; production never shows them.
// NEXT_PUBLIC_ because deploys go out prebuilt (see src/lib/tickets.ts).
export const visible =
  process.env.NEXT_PUBLIC_VERCEL_ENV === "production"
    ? eq(tickets.test, false)
    : undefined;

/** Visible and for this year's event: what the desk and check-in work from. */
export const thisYear = and(visible, eq(tickets.year, EVENT_YEAR));

/** holdsTicket as a WHERE clause. */
const heldBy = (userId: string, email: string) =>
  or(
    eq(tickets.holderUserId, userId),
    and(
      isNull(tickets.holderUserId),
      eq(tickets.purchaserEmail, emailKey(email)),
    ),
  );

/** Display name for a stored tier, which may be a tier id ("standard") or already a label. */
export function ticketLabel(tier: string | null): string {
  if (!tier) return "Metagame 2026 ticket";
  if (tier === supporterTier.id) return supporterTier.label;
  return getTicket(tier)?.label ?? getDayPass(tier)?.label ?? tier;
}

const STATUS: Record<PurchaseStatus, Ticket["status"]> = {
  Pending: "pending",
  Paid: "paid",
  Failed: "failed",
  Underpaid: "underpaid",
};

/** The ticket row a webhook purchase maps to. Never carries ownership. */
export function ticketFromPurchase(purchase: PurchaseRecord): Ticket {
  return {
    paymentId: purchase.id,
    ticketCode: purchase.ticketCode ?? ticketCode(purchase.id),
    source: purchase.paymentMethod === "btc" ? "opennode" : "stripe",
    status: STATUS[purchase.status],
    test: purchase.test,
    tier: purchase.ticketType ?? null,
    year: ticketYear(purchase.ticketType),
    amountCents:
      purchase.amount != null ? Math.round(purchase.amount * 100) : null,
    couponCode: purchase.couponCode?.trim().toUpperCase() || null,
    purchaserEmail: emailKey(purchase.customerEmail ?? "") || null,
    purchaserName: purchase.preferredName ?? purchase.customerName ?? null,
    purchaserDiscord: cleanDiscordHandle(purchase.discordHandle) ?? null,
  };
}

// Upsert on payment id, so a redelivered webhook walks the same row through
// pending → paid. Blank fields never clobber, and the code, owner and holder
// are left alone: a retry must never un-claim a ticket or revive an old code.
// `referredBy` is the referrer's payment id off the checkout's metadata; it
// only lands when that ticket exists, so a stale link can't break the write.
export async function recordTicket(
  purchase: PurchaseRecord,
  { referredBy }: { referredBy?: string } = {},
): Promise<void> {
  if (!env.DATABASE_URL) {
    console.warn(`[tickets] DATABASE_URL not set — not stored: ${purchase.id}`);
    return;
  }
  const db = getDb();
  const row = ticketFromPurchase(purchase);
  if (referredBy) {
    const [referrer] = await db
      .select({ id: tickets.paymentId })
      .from(tickets)
      .where(eq(tickets.paymentId, referredBy))
      .limit(1);
    if (referrer) row.referredByPaymentId = referredBy;
    else console.warn(`[tickets] referrer ${referredBy} not found`);
  }
  const {
    status,
    test,
    tier,
    year,
    amountCents,
    couponCode,
    purchaserEmail,
    purchaserName,
    purchaserDiscord,
    referredByPaymentId,
  } = row;
  const set = Object.fromEntries(
    Object.entries({
      status,
      test,
      tier,
      year,
      amountCents,
      couponCode,
      purchaserEmail,
      purchaserName,
      purchaserDiscord,
      referredByPaymentId,
    }).filter(([, v]) => v != null),
  );
  await db
    .insert(schema.tickets)
    .values(row)
    .onConflictDoUpdate({ target: schema.tickets.paymentId, set });
}

/**
 * The code a payment's ticket has now, for webhooks to record in Airtable:
 * unclaiming swaps the derived code for a random one.
 */
export async function currentTicketCode(paymentId: string): Promise<string> {
  if (env.DATABASE_URL) {
    try {
      const [row] = await getDb()
        .select({ code: tickets.ticketCode })
        .from(tickets)
        .where(eq(tickets.paymentId, paymentId))
        .limit(1);
      if (row) return row.code;
    } catch (err) {
      // The purchase must still reach Airtable; the derived code is right
      // unless the ticket was unclaimed, which a DB outage can't tell us.
      console.error("[tickets] current code lookup failed", paymentId, err);
    }
  }
  return ticketCode(paymentId);
}

/** Flip a recorded ticket to failed; no row, no-op. Idempotent. */
export async function markTicketFailed(paymentId: string): Promise<void> {
  if (!env.DATABASE_URL) return;
  await getDb()
    .update(schema.tickets)
    .set({ status: "failed" })
    .where(eq(schema.tickets.paymentId, paymentId));
}

/** Tickets the user owns, holds or bought. Newest first. */
export async function ticketsForUser(
  userId: string,
  email: string,
): Promise<TicketRow[]> {
  return getDb()
    .select()
    .from(tickets)
    .where(
      and(
        visible,
        or(
          eq(tickets.ownerUserId, userId),
          eq(tickets.holderUserId, userId),
          eq(tickets.purchaserEmail, emailKey(email)),
        ),
      ),
    )
    .orderBy(desc(tickets.createdAt));
}

/** Every ticket, newest first, for the admin table. */
export async function allTickets(): Promise<TicketRow[]> {
  return getDb()
    .select()
    .from(tickets)
    .where(visible)
    .orderBy(desc(tickets.createdAt));
}

/** How many tickets each of these accounts has claimed; absent means none. */
export async function claimedCounts(
  userIds: string[],
): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();
  const rows = await getDb()
    .select({ userId: tickets.ownerUserId, n: count() })
    .from(tickets)
    .where(and(visible, inArray(tickets.ownerUserId, userIds)))
    .groupBy(tickets.ownerUserId);
  return new Map(rows.map((r) => [r.userId!, r.n]));
}

/** The badge number on each account's claimed paid ticket; absent means none yet. */
export async function badgeCodesFor(
  userIds: string[],
): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();
  const rows = await getDb()
    .select({ userId: tickets.ownerUserId, badge: tickets.badgeCode })
    .from(tickets)
    .where(
      and(
        visible,
        inArray(tickets.ownerUserId, userIds),
        eq(tickets.status, "paid"),
        isNotNull(tickets.badgeCode),
      ),
    );
  return new Map(rows.map((r) => [r.userId!, r.badge!]));
}

/** Whether the user has claimed a paid ticket as their own. */
export async function hasClaimedTicket(userId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: tickets.paymentId })
    .from(tickets)
    .where(
      and(visible, eq(tickets.ownerUserId, userId), eq(tickets.status, "paid")),
    )
    .limit(1);
  return row !== undefined;
}

export type ClaimResult =
  | { ok: true; ticket: TicketRow }
  | {
      ok: false;
      reason:
        | "unknown"
        | "yours"
        | "already"
        | "taken"
        | "unpaid"
        | "void"
        | "checkedIn"
        | "limited";
    };

// Codes are short enough to guess by script, so failed claims are capped per
// account. Kept in Better Auth's verification table, like sentRecently().
const CLAIM_FAILURE_LIMIT = 25;
const CLAIM_FAILURE_WINDOW_MS = 60 * 60 * 1000;

export async function claimTicket(
  userId: string,
  code: string,
): Promise<ClaimResult> {
  const db = getDb();
  const identifier = `claim-failed:${userId}`;
  const now = new Date();
  await db
    .delete(verification)
    .where(
      and(
        eq(verification.identifier, identifier),
        lte(verification.expiresAt, now),
      ),
    );
  const [{ failures }] = await db
    .select({ failures: count() })
    .from(verification)
    .where(eq(verification.identifier, identifier));
  if (failures >= CLAIM_FAILURE_LIMIT) return { ok: false, reason: "limited" };

  const result = await attemptClaim(userId, code);
  if (!result.ok && result.reason !== "yours" && result.reason !== "already") {
    await db.insert(verification).values({
      id: crypto.randomUUID(),
      identifier,
      value: code,
      expiresAt: new Date(now.getTime() + CLAIM_FAILURE_WINDOW_MS),
    });
  }
  return result;
}

/** The holder claims a ticket for themselves, without typing its code. */
export async function claimOwnTicket(
  userId: string,
  email: string,
  paymentId: string,
): Promise<ClaimResult> {
  const [ticket] = await getDb()
    .select({ ticketCode: tickets.ticketCode })
    .from(tickets)
    .where(
      and(visible, eq(tickets.paymentId, paymentId), heldBy(userId, email)),
    )
    .limit(1);
  if (!ticket) return { ok: false, reason: "unknown" };
  return attemptClaim(userId, ticket.ticketCode);
}

const attemptClaim = (userId: string, code: string) =>
  claimMatching(userId, eq(tickets.ticketCode, code));

/** No failure throttle: the volunteer picks the ticket rather than guessing a code. */
export const claimTicketFor = (
  byUserId: string,
  paymentId: string,
  forUserId: string,
) => claimMatching(forUserId, eq(tickets.paymentId, paymentId), byUserId);

// One conditional UPDATE, so two people entering the same code can't both win.
async function claimMatching(
  userId: string,
  match: SQL,
  claimedBy: string | null = null,
): Promise<ClaimResult> {
  const db = getDb();
  const [ticket] = await db
    .update(tickets)
    .set({ ownerUserId: userId, claimedAt: new Date(), claimedBy })
    .where(
      and(
        visible,
        match,
        isNull(tickets.ownerUserId),
        isNull(tickets.checkedInAt),
        eq(tickets.status, "paid"),
        // One admission per person, checked in the same statement so two
        // claims at once can't both win.
        sql`not exists (select 1 from "tickets" mine where mine."owner_user_id" = ${userId} and mine."status" = 'paid')`,
      ),
    )
    .returning();
  if (ticket) return { ok: true, ticket };

  const [existing] = await db
    .select()
    .from(tickets)
    .where(and(visible, match))
    .limit(1);
  if (!existing) return { ok: false, reason: "unknown" };
  if (existing.ownerUserId === userId) return { ok: false, reason: "yours" };
  const [held] = await db
    .select({ id: tickets.paymentId })
    .from(tickets)
    .where(and(eq(tickets.ownerUserId, userId), eq(tickets.status, "paid")))
    .limit(1);
  if (held) return { ok: false, reason: "already" };
  if (existing.ownerUserId) return { ok: false, reason: "taken" };
  if (existing.checkedInAt) return { ok: false, reason: "checkedIn" };
  return {
    ok: false,
    reason: existing.status === "pending" ? "unpaid" : "void",
  };
}

export type UnclaimResult =
  | { ok: true; ticket: TicketRow }
  | { ok: false; reason: "notYours" | "checkedIn" };

/**
 * The attendee gives up their spot but keeps the ticket: it becomes theirs to
 * hold, unclaimed, under a fresh code, so the old one stops working.
 */
export async function unclaimTicket(
  userId: string,
  paymentId: string,
): Promise<UnclaimResult> {
  const db = getDb();
  const ticket = await withFreshTicketCode(async (code) => {
    const [row] = await db
      .update(tickets)
      .set({
        ownerUserId: null,
        claimedAt: null,
        claimedBy: null,
        holderUserId: userId,
        ticketCode: code,
        badgeCode: null,
      })
      .where(
        and(
          visible,
          eq(tickets.paymentId, paymentId),
          eq(tickets.ownerUserId, userId),
          eq(tickets.status, "paid"),
          // Checked in means the badge is on someone; the spot can't be passed on.
          isNull(tickets.checkedInAt),
        ),
      )
      .returning();
    return row ?? null;
  });
  if (!ticket) {
    const [existing] = await db
      .select({ checkedInAt: tickets.checkedInAt })
      .from(tickets)
      .where(
        and(
          visible,
          eq(tickets.paymentId, paymentId),
          eq(tickets.ownerUserId, userId),
        ),
      )
      .limit(1);
    return {
      ok: false,
      reason: existing?.checkedInAt ? "checkedIn" : "notYours",
    };
  }
  try {
    await updatePurchaseTicketCode(ticket.paymentId, ticket.ticketCode);
  } catch (e) {
    console.error(`[tickets] Airtable code update failed: ${paymentId}`, e);
    await sendAdminErrorEmail(
      `Airtable Ticket Code update failed after an unclaim (payment ${paymentId}); it should read ${ticket.ticketCode}: ${e instanceof Error ? e.message : String(e)}`,
    ).catch((adminErr) =>
      console.error("[tickets] admin alert failed:", adminErr),
    );
  }
  return { ok: true, ticket };
}

export type CheckInResult =
  | { ok: true; ticket: TicketRow }
  | { ok: false; reason: "unknown" | "unclaimed" | "unpaid" }
  | { ok: false; reason: "already"; ticket: TicketRow };

/** Marks a claimed, paid ticket checked in at the desk. */
export async function checkInTicket(
  byUserId: string,
  paymentId: string,
): Promise<CheckInResult> {
  const db = getDb();
  const [ticket] = await db
    .update(tickets)
    .set({ checkedInAt: new Date(), checkedInBy: byUserId })
    .where(
      and(
        visible,
        eq(tickets.paymentId, paymentId),
        isNotNull(tickets.ownerUserId),
        eq(tickets.status, "paid"),
        isNull(tickets.checkedInAt),
      ),
    )
    .returning();
  if (ticket) return { ok: true, ticket };

  const [existing] = await db
    .select()
    .from(tickets)
    .where(and(visible, eq(tickets.paymentId, paymentId)))
    .limit(1);
  if (!existing) return { ok: false, reason: "unknown" };
  if (existing.checkedInAt)
    return { ok: false, reason: "already", ticket: existing };
  if (existing.status !== "paid") return { ok: false, reason: "unpaid" };
  return { ok: false, reason: "unclaimed" };
}

/** Reverses a check-in; null when the ticket isn't checked in. */
export async function undoCheckIn(
  paymentId: string,
): Promise<TicketRow | null> {
  const [ticket] = await getDb()
    .update(tickets)
    .set({ checkedInAt: null, checkedInBy: null })
    .where(
      and(
        visible,
        eq(tickets.paymentId, paymentId),
        isNotNull(tickets.checkedInAt),
      ),
    )
    .returning();
  return ticket ?? null;
}

export type BadgeCodeResult =
  | { ok: true; ticket: TicketRow }
  | { ok: false; reason: "unknown" | "invalid" | "taken" };

/** Sets the badge number typed in from the sticker; null takes it off. */
export async function assignBadgeCode(
  paymentId: string,
  code: number | null,
): Promise<BadgeCodeResult> {
  if (code !== null && !isBadgeCode(code)) {
    return { ok: false, reason: "invalid" };
  }
  try {
    const [ticket] = await getDb()
      .update(tickets)
      .set({ badgeCode: code })
      .where(and(visible, eq(tickets.paymentId, paymentId)))
      .returning();
    return ticket ? { ok: true, ticket } : { ok: false, reason: "unknown" };
  } catch (e) {
    if (code === null || !isUniqueViolation(e)) throw e;
    return { ok: false, reason: "taken" };
  }
}
