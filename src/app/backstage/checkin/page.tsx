import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import SignIn from "../SignIn";
import type { DeskTicket } from "./desk";
import ProblemButton from "./ProblemButton";
import SearchBox from "./SearchBox";
import DeskRow from "./TicketRow";
import { toolAccess } from "@/lib/admin-auth";
import { formatBadgeCode } from "@/lib/badge-code";
import {
  attendeeName,
  CHECKIN_MIN_CHARS,
  checkinState,
  formatPacificTime,
  groupByPack,
  packKey,
  parseCheckinQuery,
  type CheckinAccount,
} from "@/lib/checkin";
import {
  CHECKIN_PAGE_SIZE,
  CHECKIN_SEARCH_LIMIT,
  checkinAccounts,
  checkinCounts,
  listCheckinTickets,
  searchCheckinTickets,
} from "@/lib/checkin-store";
import { ticketLabel, type TicketRow } from "@/lib/ticket-store";

export default async function CheckinPage(
  props: PageProps<"/backstage/checkin">,
) {
  await connection();
  const sp = await props.searchParams;
  const { text: q, badge } = parseCheckinQuery(String([sp.q].flat()[0] ?? ""));
  const page = Math.max(1, Math.floor(Number([sp.page].flat()[0]) || 1));
  const self = `/backstage/checkin${q ? `?q=${encodeURIComponent(q)}` : page > 1 ? `?page=${page}` : ""}`;

  const access = await toolAccess("checkin.manage");
  if (!access) return <SignIn next={self} />;

  const [counts, listed] = await Promise.all([
    checkinCounts(),
    q
      ? searchCheckinTickets(q).then((rows) => ({ rows, total: null }))
      : listCheckinTickets(page),
  ]);
  const rows = listed.rows;
  const pages =
    listed.total === null
      ? 1
      : Math.max(1, Math.ceil(listed.total / CHECKIN_PAGE_SIZE));
  if (!q && page > pages) redirect(`/backstage/checkin?page=${pages}`);
  const { byId, byEmail } = await checkinAccounts(rows);
  const owners = new Set(rows.map((t) => t.ownerUserId));
  // A pack's buyer is offered once, on its first unclaimed ticket.
  const buyerOffered = new Set<string>();
  const suggested = (t: TicketRow): CheckinAccount | null => {
    if (t.ownerUserId !== null) return null;
    if (t.holderUserId !== null) return byId.get(t.holderUserId) ?? null;
    if (t.purchaserEmail === null) return null;
    const pack = packKey(t.paymentId);
    if (pack !== null) {
      if (buyerOffered.has(pack)) return null;
      buyerOffered.add(pack);
    }
    const buyer = byEmail.get(t.purchaserEmail);
    return buyer && !owners.has(buyer.id) ? buyer : null;
  };
  const packSize = new Map<string, number>();
  for (const t of rows) {
    const pack = packKey(t.paymentId);
    if (pack !== null) packSize.set(pack, (packSize.get(pack) ?? 0) + 1);
  }
  const packSeen = new Map<string, number>();
  const tickets: DeskTicket[] = rows.map((t) => {
    const by = t.checkedInBy ? byId.get(t.checkedInBy) : undefined;
    const pack = packKey(t.paymentId);
    const nth = pack === null ? 0 : (packSeen.get(pack) ?? 0) + 1;
    if (pack !== null) packSeen.set(pack, nth);
    const named = attendeeName({
      ownerName: t.ownerUserId ? (byId.get(t.ownerUserId)?.name ?? null) : null,
      holderName: t.holderUserId
        ? (byId.get(t.holderUserId)?.name ?? null)
        : null,
      purchaserName: null,
      purchaserEmail: null,
    });
    const tier = ticketLabel(t.tier);
    // A spare pack ticket is nobody's yet; naming it after the buyer reads as a duplicate.
    const spare = pack !== null && named === null && t.ownerUserId === null;
    const name =
      named ??
      (spare
        ? "Pack ticket, nobody yet"
        : t.purchaserName?.trim() || t.purchaserEmail || "No name on purchase");
    const subtitle = spare
      ? `${nth} of ${packSize.get(pack)}`
      : t.purchaserEmail && name !== t.purchaserEmail
        ? t.purchaserEmail
        : tier;
    const offered = suggested(t);
    return {
      paymentId: t.paymentId,
      name,
      subtitle,
      purchaserEmail: t.purchaserEmail,
      purchaserName: t.purchaserName?.trim() || null,
      tier,
      badge: t.badgeCode,
      state: checkinState(t),
      checkedIn: t.checkedInAt
        ? { at: formatPacificTime(t.checkedInAt), by: by?.name ?? "someone" }
        : null,
      suggested: offered,
      buyerNeedsAccount:
        offered === null &&
        !spare &&
        t.ownerUserId === null &&
        t.purchaserEmail !== null &&
        !byEmail.has(t.purchaserEmail),
    };
  });
  const groups = groupByPack(tickets);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-lg text-ink/80">
          <strong className="text-navy">{counts.checkedIn}</strong> checked in /{" "}
          {counts.paid} paid tickets
        </p>
        <ProblemButton q={q} />
      </div>
      <SearchBox initial={q} />
      {q.length > 0 && q.length < CHECKIN_MIN_CHARS && badge === null && (
        <p className="text-sm text-ink/60">Type at least two characters.</p>
      )}
      {(q.length >= CHECKIN_MIN_CHARS || badge !== null) &&
        tickets.length === 0 && (
          <p className="text-sm text-ink/60">
            {badge !== null
              ? `No ticket has badge ${formatBadgeCode(badge)}.`
              : `No ticket matches “${q}”. Try the purchaser’s email or the ticket code from their confirmation.`}
          </p>
        )}
      {q && rows.length >= CHECKIN_SEARCH_LIMIT && (
        <p className="text-sm text-ink/60">
          Showing the first {CHECKIN_SEARCH_LIMIT} matches. Add more of the name
          or the email.
        </p>
      )}
      <ul className="divide-y divide-line rounded-xl border border-line">
        {groups.map((g) =>
          g.pack === null ? (
            <li key={g.tickets[0].paymentId}>
              <DeskRow ticket={g.tickets[0]} />
            </li>
          ) : (
            <li key={g.pack} className="border-l-4 border-navy/40">
              <p className="px-3 pt-2 text-xs text-ink/70">
                <span className="font-semibold text-navy">
                  Family &amp; Friends Pack
                </span>{" "}
                · {g.tickets.length} tickets
                {g.tickets[0].purchaserEmail && (
                  <>
                    {" "}
                    · bought by{" "}
                    <span className="font-mono">
                      {g.tickets[0].purchaserEmail}
                    </span>
                  </>
                )}
              </p>
              <div className="divide-y divide-line">
                {g.tickets.map((t) => (
                  <DeskRow key={t.paymentId} ticket={t} />
                ))}
              </div>
            </li>
          ),
        )}
      </ul>
      {!q && pages > 1 && (
        <nav className="flex items-center justify-between gap-3 text-sm">
          {page > 1 ? (
            <Link
              href={`/backstage/checkin?page=${page - 1}`}
              className="px-4 py-3 font-semibold text-navy"
            >
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-ink/60">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link
              href={`/backstage/checkin?page=${page + 1}`}
              className="px-4 py-3 font-semibold text-navy"
            >
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </>
  );
}
