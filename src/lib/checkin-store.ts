import {
  and,
  asc,
  count,
  eq,
  ilike,
  inArray,
  like,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/db";
import {
  CHECKIN_MIN_CHARS,
  packKey,
  parseCheckinQuery,
  type CheckinAccount,
} from "@/lib/checkin";
import { escapeLike, likeContains } from "@/lib/like";
import { accountName } from "@/lib/schedule-store";
import { emailKey } from "@/lib/ticket-holder";
import { visible, type TicketRow } from "@/lib/ticket-store";

const { tickets, user } = schema;

export const CHECKIN_SEARCH_LIMIT = 25;
export const CHECKIN_PAGE_SIZE = 50;

/** Only paid tickets and ones still waiting on payment matter at the desk. */
const atDesk = and(visible, inArray(tickets.status, ["paid", "pending"]));

/**
 * Tickets matching what the volunteer typed, with the rest of any pack a hit
 * belongs to so the buyer's tickets sit together. Digits look up a badge
 * number only; anything else searches names and emails, with an exact ticket
 * code first. Empty when the query is too short to mean anything.
 */
export async function searchCheckinTickets(raw: string): Promise<TicketRow[]> {
  const { text, code, badge } = parseCheckinQuery(raw);
  if (badge === null && text.length < CHECKIN_MIN_CHARS) return [];
  const owner = alias(user, "owner");
  const holder = alias(user, "holder");
  const q = likeContains(text);
  const matches: (SQL | undefined)[] =
    badge !== null
      ? [eq(tickets.badgeCode, badge)]
      : [
          code ? eq(tickets.ticketCode, code) : undefined,
          ilike(tickets.purchaserName, q),
          ilike(tickets.purchaserEmail, q),
          ilike(owner.name, q),
          ilike(owner.email, q),
          ilike(holder.name, q),
          ilike(holder.email, q),
        ];
  const db = getDb();
  const hits = await db
    .select({ ticket: tickets })
    .from(tickets)
    .leftJoin(owner, eq(owner.id, tickets.ownerUserId))
    .leftJoin(holder, eq(holder.id, tickets.holderUserId))
    .where(and(atDesk, or(...matches.filter((m) => m !== undefined))))
    .orderBy(
      ...(code ? [sql`(${tickets.ticketCode} = ${code}) desc`] : []),
      asc(sql`lower(coalesce(${owner.name}, ${tickets.purchaserName}, ''))`),
      asc(tickets.paymentId),
    )
    .limit(CHECKIN_SEARCH_LIMIT);
  const rows = hits.map((h) => h.ticket);

  const packs = [
    ...new Set(rows.map((t) => packKey(t.paymentId)).filter((p) => p !== null)),
  ];
  if (packs.length === 0) return rows;
  const seen = new Set(rows.map((t) => t.paymentId));
  const siblings = await db
    .select()
    .from(tickets)
    .where(
      and(
        atDesk,
        or(
          ...packs.map((p) =>
            like(tickets.paymentId, `${escapeLike(p)}:ticket:%`),
          ),
        ),
      ),
    )
    .orderBy(asc(tickets.paymentId));
  return [...rows, ...siblings.filter((t) => !seen.has(t.paymentId))];
}

/** Every paid ticket, alphabetical by attendee, one page at a time. */
export async function listCheckinTickets(
  page: number,
): Promise<{ rows: TicketRow[]; total: number }> {
  const owner = alias(user, "owner");
  const paid = and(visible, eq(tickets.status, "paid"));
  const db = getDb();
  const [[{ total }], hits] = await Promise.all([
    db.select({ total: count() }).from(tickets).where(paid),
    db
      .select({ ticket: tickets })
      .from(tickets)
      .leftJoin(owner, eq(owner.id, tickets.ownerUserId))
      .where(paid)
      .orderBy(
        asc(sql`lower(coalesce(${owner.name}, ${tickets.purchaserName}, ''))`),
        asc(tickets.paymentId),
      )
      .limit(CHECKIN_PAGE_SIZE)
      .offset((page - 1) * CHECKIN_PAGE_SIZE),
  ]);
  return { rows: hits.map((h) => h.ticket), total };
}

/** Everyone these tickets name: owner, holder, who checked them in, and buyers by email. */
export async function checkinAccounts(rows: TicketRow[]): Promise<{
  byId: Map<string, CheckinAccount>;
  byEmail: Map<string, CheckinAccount>;
}> {
  const ids = [
    ...new Set(
      rows
        .flatMap((t) => [t.ownerUserId, t.holderUserId, t.checkedInBy])
        .filter((x) => x !== null),
    ),
  ];
  const emails = [
    ...new Set(rows.map((t) => t.purchaserEmail).filter((x) => x !== null)),
  ];
  const found =
    ids.length + emails.length === 0
      ? []
      : await getDb()
          .select({ id: user.id, name: accountName, email: user.email })
          .from(user)
          .where(
            or(
              ids.length ? inArray(user.id, ids) : undefined,
              emails.length
                ? inArray(sql`lower(${user.email})`, emails)
                : undefined,
            ),
          );
  return {
    byId: new Map(found.map((a) => [a.id, a])),
    byEmail: new Map(found.map((a) => [emailKey(a.email), a])),
  };
}

/** The header's tally over paid tickets. */
export async function checkinCounts(): Promise<{
  checkedIn: number;
  paid: number;
}> {
  const [{ paid, checkedIn }] = await getDb()
    .select({
      paid: count(),
      checkedIn: count(tickets.checkedInAt),
    })
    .from(tickets)
    .where(and(visible, eq(tickets.status, "paid")));
  return { paid, checkedIn };
}

/** The ticket as the desk sees it, before writing to it. */
export async function deskTicket(paymentId: string): Promise<TicketRow | null> {
  const [row] = await getDb()
    .select()
    .from(tickets)
    .where(and(visible, eq(tickets.paymentId, paymentId)))
    .limit(1);
  return row ?? null;
}

/** Who wears a badge number already, for the "taken" message. */
export async function badgeWearer(code: number): Promise<string | null> {
  const owner = alias(user, "owner");
  const [row] = await getDb()
    .select({
      name: sql<string>`coalesce(nullif(trim(${owner.name}), ''), ${owner.email}, ${tickets.purchaserName})`,
    })
    .from(tickets)
    .leftJoin(owner, eq(owner.id, tickets.ownerUserId))
    .where(and(visible, eq(tickets.badgeCode, code)))
    .limit(1);
  return row?.name ?? null;
}
