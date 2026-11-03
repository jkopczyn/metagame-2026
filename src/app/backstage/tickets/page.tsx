import { eq } from "drizzle-orm";
import Link from "next/link";
import { connection } from "next/server";
import { profileHref } from "./parts";
import TicketsTable, {
  type AdminTicket,
  type TableState,
} from "./TicketsTable";
import ToolSignIn from "@/components/ToolSignIn";
import { getDb, schema } from "@/db";
import {
  PAGE_SIZES,
  ticketPeople,
  TICKET_SORTS,
  type TicketSort,
} from "@/lib/admin-tickets";
import { ticketAccounts } from "@/lib/admin-store";
import { can } from "@/lib/access";
import { formatReferralCode } from "@/lib/referral";
import { referralFacts } from "@/lib/referral-store";
import { formatTicketCode } from "@/lib/ticket-code-format";
import { allTickets, ticketLabel, ticketsForUser } from "@/lib/ticket-store";

const one = (v: string | string[] | undefined) =>
  String(Array.isArray(v) ? v[0] : (v ?? "")).trim();

// Account-only, like /backstage/users: it lists every buyer's email.
export default async function AdminTicketsPage(
  props: PageProps<"/backstage/tickets">,
) {
  await connection();

  const session = await can("tickets.view");
  if (!session) return <ToolSignIn title="Tickets" next="/backstage/tickets" />;

  const params = await props.searchParams;
  const userId = one(params.user);
  const sortParam = one(params.sort);
  const sort: TicketSort = (TICKET_SORTS as readonly string[]).includes(
    sortParam,
  )
    ? (sortParam as TicketSort)
    : "purchased";
  const dirParam = one(params.dir);
  const size = Number(one(params.size));
  const initial: TableState = {
    q: one(params.q),
    sort,
    dir:
      dirParam === "asc" || dirParam === "desc"
        ? dirParam
        : sort === "purchased" || sort === "pay"
          ? "desc"
          : "asc",
    size: (PAGE_SIZES as readonly number[]).includes(size)
      ? size
      : PAGE_SIZES[0],
    page: Number(one(params.page)) || 1,
  };

  const [forUser] = userId
    ? await getDb()
        .select({
          id: schema.user.id,
          name: schema.user.name,
          email: schema.user.email,
        })
        .from(schema.user)
        .where(eq(schema.user.id, userId))
        .limit(1)
    : [];
  const rows = userId
    ? forUser
      ? await ticketsForUser(forUser.id, forUser.email)
      : []
    : await allTickets();
  const [{ accounts, byEmail }, { referredBy, referrals }] = await Promise.all([
    ticketAccounts(rows),
    referralFacts(rows),
  ]);
  const tickets: AdminTicket[] = rows.map((t) => {
    const referrer = referredBy.get(t.paymentId);
    return {
      t: {
        id: t.paymentId,
        createdAt: t.createdAt,
        claimedAt: t.claimedAt,
        tier: ticketLabel(t.tier),
        status: t.status,
        test: t.test,
        code: formatTicketCode(t.ticketCode),
        source: t.source,
        amountCents: t.amountCents,
        couponCode: t.couponCode,
        referralCode: t.referralCode && formatReferralCode(t.referralCode),
        referredBy: referrer ? formatTicketCode(referrer) : null,
        referrals: referrals.get(t.paymentId) ?? 0,
      },
      people: ticketPeople(t, accounts, byEmail),
    };
  });

  return (
    <div className="space-y-4">
      {userId && (
        <p className="text-sm text-ink/60">
          Tickets bought, held or claimed by{" "}
          {forUser ? (
            <Link
              href={profileHref(forUser.id)}
              className="text-navy hover:text-meeple hover:underline"
            >
              {forUser.name.trim() || forUser.email}
            </Link>
          ) : (
            "an unknown account"
          )}{" "}
          ·{" "}
          <Link
            href="/backstage/tickets"
            className="text-navy hover:text-meeple hover:underline"
          >
            all tickets
          </Link>
        </p>
      )}
      <TicketsTable tickets={tickets} initial={initial} />
    </div>
  );
}
