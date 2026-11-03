// Client-safe labelling for the admin tickets table and profile view.
import { emailKey, holdsTicket } from "@/lib/ticket-holder";

export type AdminAccount = { id: string; name: string; email: string };

/** Someone on a ticket: an account when we have one, else the purchase's own details. */
export type TicketPerson = {
  userId: string | null;
  name: string | null;
  email: string | null;
};

type PeopleFields = {
  purchaserEmail: string | null;
  purchaserName: string | null;
  holderUserId: string | null;
  ownerUserId: string | null;
};

export type TicketPeople = {
  buyer: TicketPerson | null;
  holder: TicketPerson | null;
  /** Null holder_user_id: the buyer holds it. */
  holderIsBuyer: boolean;
  claimer: TicketPerson | null;
};

const fromAccount = (a: AdminAccount): TicketPerson => ({
  userId: a.id,
  name: a.name,
  email: a.email,
});

function byId(
  id: string | null,
  accounts: Map<string, AdminAccount>,
): TicketPerson | null {
  if (id === null) return null;
  const a = accounts.get(id);
  return a ? fromAccount(a) : { userId: id, name: null, email: null };
}

/**
 * Buyer, holder and claimer of a ticket. `accounts` is keyed by id and
 * `byEmail` by emailKey, so a buyer links to their account when one exists.
 */
export function ticketPeople(
  t: PeopleFields,
  accounts: Map<string, AdminAccount>,
  byEmail: Map<string, AdminAccount>,
): TicketPeople {
  const account = t.purchaserEmail ? byEmail.get(t.purchaserEmail) : undefined;
  const buyer: TicketPerson | null =
    t.purchaserEmail || t.purchaserName
      ? {
          userId: account?.id ?? null,
          name: t.purchaserName ?? account?.name ?? null,
          email: t.purchaserEmail,
        }
      : null;
  const holderIsBuyer = t.holderUserId === null;
  return {
    buyer,
    holder: holderIsBuyer ? buyer : byId(t.holderUserId, accounts),
    holderIsBuyer,
    claimer: byId(t.ownerUserId, accounts),
  };
}

export const personLabel = (p: TicketPerson) =>
  p.name?.trim() || p.email || p.userId || "Unknown";

/** Case-insensitive match on any name or email on the ticket. */
export function peopleMatch(people: TicketPeople, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [people.buyer, people.holder, people.claimer].some(
    (p) =>
      p !== null &&
      [p.name, p.email].some((s) => s?.toLowerCase().includes(q) ?? false),
  );
}

/** peopleMatch, or a match on the coupon code the buyer used. */
export function ticketMatch(
  r: { t: { couponCode: string | null }; people: TicketPeople },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  return (
    peopleMatch(r.people, q) ||
    (r.t.couponCode?.toLowerCase().includes(q) ?? false)
  );
}

/**
 * Why a ticket gets the bring-a-friend swag, or null: it was bought with a
 * referral (pack admissions count, linked to the pack's first) or referred
 * someone. Only paid referees count either way.
 */
export function swagReason(t: {
  referredBy: string | null;
  referrals: number;
}): string | null {
  if (t.referredBy !== null) return `Referred by ${t.referredBy}`;
  if (t.referrals > 0)
    return `Referred ${t.referrals} ${t.referrals === 1 ? "friend" : "friends"}`;
  return null;
}

export type TicketRole = "bought" | "holds" | "claimed";

/** How one account relates to a ticket, for their profile. */
export function ticketRoles(
  t: Omit<PeopleFields, "purchaserName">,
  userId: string,
  email: string,
): TicketRole[] {
  const roles: TicketRole[] = [];
  if (t.purchaserEmail !== null && t.purchaserEmail === emailKey(email))
    roles.push("bought");
  if (holdsTicket(t, userId, email)) roles.push("holds");
  if (t.ownerUserId === userId) roles.push("claimed");
  return roles;
}

/** The users table's ticket cell: gray with none, "×n" with more than one. */
export function ticketBadge(count: number): {
  has: boolean;
  label: string | null;
} {
  return { has: count > 0, label: count > 1 ? `×${count}` : null };
}

export const TICKET_SORTS = ["purchased", "buyer", "claimer", "pay"] as const;
export type TicketSort = (typeof TICKET_SORTS)[number];
export type SortDir = "asc" | "desc";

/** Sorts by purchase time or a person's label; people-less rows sort last either way. */
export function sortTicketRows<
  R extends {
    t: { createdAt: Date; amountCents?: number | null };
    people: TicketPeople;
  },
>(rows: R[], sort: TicketSort, dir: SortDir): R[] {
  const sign = dir === "asc" ? 1 : -1;
  const label = (r: R) => {
    const p = sort === "buyer" ? r.people.buyer : r.people.claimer;
    return p ? personLabel(p).toLowerCase() : null;
  };
  return [...rows].sort((a, b) => {
    if (sort === "purchased")
      return sign * (a.t.createdAt.getTime() - b.t.createdAt.getTime());
    if (sort === "pay") {
      const [x, y] = [a.t.amountCents ?? null, b.t.amountCents ?? null];
      if (x === y) return b.t.createdAt.getTime() - a.t.createdAt.getTime();
      if (x === null) return 1;
      if (y === null) return -1;
      return sign * (x - y);
    }
    const [x, y] = [label(a), label(b)];
    if (x === y) return b.t.createdAt.getTime() - a.t.createdAt.getTime();
    if (x === null) return 1;
    if (y === null) return -1;
    return sign * x.localeCompare(y);
  });
}

export const PAGE_SIZES = [25, 50, 100, 200] as const;
export const TICKETS_PAGE_SIZE = PAGE_SIZES[0];

/** One page of `rows`, with `page` clamped to what exists (1-based). */
export function pageOf<R>(
  rows: R[],
  page: number,
  size: number = TICKETS_PAGE_SIZE,
) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const at = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { rows: rows.slice((at - 1) * size, at * size), page: at, pages };
}
