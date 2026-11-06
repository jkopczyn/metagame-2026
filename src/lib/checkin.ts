// Client-safe helpers for the check-in desk: what a volunteer typed, what
// state a ticket is in, and how pack tickets group.
import { BADGE_CODE_MAX } from "./badge-code";
import { normalizeTicketCode, TICKET_CODE_LENGTH } from "./ticket-code-format";

export const CHECKIN_QUERY_MAX = 100;
export const CHECKIN_MIN_CHARS = 2;

export type CheckinQuery = {
  text: string;
  /** Set when the text reads as a whole ticket code. */
  code: string | null;
  /** Set when the text is a badge number: up to four digits. */
  badge: number | null;
};

export function parseCheckinQuery(raw: string): CheckinQuery {
  const text = raw.trim().slice(0, CHECKIN_QUERY_MAX);
  const normalized = normalizeTicketCode(text);
  const digits = /^\d{1,4}$/.test(text) ? Number(text) : null;
  return {
    text,
    code: normalized.length === TICKET_CODE_LENGTH ? normalized : null,
    badge: digits !== null && digits <= BADGE_CODE_MAX ? digits : null,
  };
}

export type CheckinAccount = { id: string; name: string; email: string };

export type CheckinState = "unpaid" | "unclaimed" | "claimed" | "checkedIn";

export function checkinState(t: {
  status: string;
  ownerUserId: string | null;
  checkedInAt: Date | null;
}): CheckinState {
  if (t.status !== "paid") return "unpaid";
  if (t.checkedInAt !== null) return "checkedIn";
  return t.ownerUserId === null ? "unclaimed" : "claimed";
}

/** The pack a `<id>:ticket:<n>` payment id belongs to, else null. */
export function packKey(paymentId: string): string | null {
  const m = /^(.+):ticket:\d+$/.exec(paymentId);
  return m ? m[1] : null;
}

export type PackGroup<T> = { pack: string | null; tickets: T[] };

/** Pack tickets together in first-seen order; everything else on its own. */
export function groupByPack<T extends { paymentId: string }>(
  rows: T[],
): PackGroup<T>[] {
  const groups: PackGroup<T>[] = [];
  const packs = new Map<string, PackGroup<T>>();
  for (const row of rows) {
    const pack = packKey(row.paymentId);
    if (pack === null) {
      groups.push({ pack: null, tickets: [row] });
      continue;
    }
    let group = packs.get(pack);
    if (!group) {
      group = { pack, tickets: [] };
      packs.set(pack, group);
      groups.push(group);
    }
    group.tickets.push(row);
  }
  return groups;
}

/**
 * Who the desk greets: the attendee's account, else whoever holds or bought
 * it, else the purchase email. Null when the ticket names nobody at all.
 */
export function attendeeName(t: {
  ownerName: string | null;
  holderName: string | null;
  purchaserName: string | null;
  purchaserEmail: string | null;
}): string | null {
  const name = [t.ownerName, t.holderName, t.purchaserName].find((n) =>
    n?.trim(),
  );
  return name?.trim() ?? t.purchaserEmail ?? null;
}

/** Typed badge digits as a number; null when blank, undefined when not a badge. */
export function parseBadgeInput(raw: string): number | null | undefined {
  const text = raw.trim();
  if (text === "") return null;
  if (!/^\d{1,4}$/.test(text)) return undefined;
  return Number(text);
}

const pacificTime = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Los_Angeles",
});

export const formatPacificTime = (d: Date) => pacificTime.format(d);
