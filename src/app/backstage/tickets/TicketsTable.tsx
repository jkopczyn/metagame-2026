"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronRight, ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  PersonLink,
  profileHref,
  shortDate,
  StatusTag,
  TestTag,
} from "./parts";
import { fieldClass, selectStyle, smallButtonClass } from "../ui";
import {
  pageOf,
  PAGE_SIZES,
  personLabel,
  sortTicketRows,
  swagReason,
  ticketMatch,
  type SortDir,
  type TicketPeople,
  type TicketPerson,
  type TicketSort,
} from "@/lib/admin-tickets";
import type { TicketRow } from "@/lib/ticket-store";
import { Dialog, DialogContent, DialogTitle } from "@/v2/components/ui/dialog";

export type AdminTicket = {
  t: {
    id: string;
    createdAt: Date;
    claimedAt: Date | null;
    tier: string;
    status: TicketRow["status"];
    test: boolean;
    code: string;
    source: string;
    amountCents: number | null;
    couponCode: string | null;
    referralCode: string | null;
    /** Four-digit badge number, once assigned. */
    badgeCode: string | null;
    /** The referrer's ticket code, when bought with a referral. */
    referredBy: string | null;
    /** Paid tickets bought with this one's code. */
    referrals: number;
  };
  people: TicketPeople;
};

export type TableState = {
  q: string;
  sort: TicketSort;
  dir: SortDir;
  size: number;
  page: number;
};

// "10/21" — the year is always this one.
const monthDay = new Intl.DateTimeFormat("en-US", {
  month: "numeric",
  day: "numeric",
  timeZone: "America/Los_Angeles",
});

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const amount = (cents: number | null) =>
  cents === null ? "—" : usd.format(cents / 100);

// Newest purchases and highest prices first; names A→Z.
const defaultDir = (sort: TicketSort): SortDir =>
  sort === "purchased" || sort === "pay" ? "desc" : "asc";

/** Sorting, search and paging all happen here; the URL just mirrors them. */
export default function TicketsTable({
  tickets,
  initial,
  canEdit,
}: {
  tickets: AdminTicket[];
  initial: TableState;
  canEdit: boolean;
}) {
  const [state, setState] = useState(initial);
  const [rows, setRows] = useState(tickets);
  // Refreshed props replace local edits, adjusted during render (not an effect).
  const [seen, setSeen] = useState(tickets);
  if (seen !== tickets) {
    setSeen(tickets);
    setRows(tickets);
  }
  const [openId, setOpenId] = useState<string | null>(null);
  const open = rows.find((r) => r.t.id === openId) ?? null;
  const { q, sort, dir, size } = state;

  // Mirrors a referral edit until the refreshed page lands: the ticket's own
  // line plus the old and new referrers' counts (only paid referees count).
  const applyReferrer = (id: string, referredBy: string | null) =>
    setRows((rows) => {
      const target = rows.find((r) => r.t.id === id);
      if (!target || target.t.referredBy === referredBy) return rows;
      const delta = (code: string | null) =>
        target.t.status === "paid" && code !== null
          ? code === target.t.referredBy
            ? -1
            : code === referredBy
              ? 1
              : 0
          : 0;
      return rows.map((r) =>
        r.t.id === id
          ? { ...r, t: { ...r.t, referredBy } }
          : delta(r.t.code)
            ? {
                ...r,
                t: { ...r.t, referrals: r.t.referrals + delta(r.t.code) },
              }
            : r,
      );
    });

  const applyBadge = (id: string, badgeCode: string | null) =>
    setRows((rows) =>
      rows.map((r) => (r.t.id === id ? { ...r, t: { ...r.t, badgeCode } } : r)),
    );

  const matching = useMemo(
    () =>
      sortTicketRows(
        rows.filter((r) => ticketMatch(r, q)),
        sort,
        dir,
      ),
    [rows, q, sort, dir],
  );
  const page = pageOf(matching, state.page, size);

  useEffect(() => {
    const url = new URL(window.location.href);
    const set = (k: string, v: string, fallback: string) =>
      v === fallback ? url.searchParams.delete(k) : url.searchParams.set(k, v);
    set("q", q, "");
    set("sort", sort, "purchased");
    set("dir", dir, defaultDir(sort));
    set("size", String(size), String(PAGE_SIZES[0]));
    set("page", String(page.page), "1");
    window.history.replaceState(null, "", url);
  }, [q, sort, dir, size, page.page]);

  const update = (next: Partial<TableState>) =>
    setState((s) => ({ ...s, page: 1, ...next }));
  const sortBy = (col: TicketSort) =>
    update(
      sort === col
        ? { dir: dir === "asc" ? "desc" : "asc" }
        : { sort: col, dir: defaultDir(col) },
    );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => update({ q: e.target.value })}
          placeholder="Search by name, email or coupon code"
          className={`${fieldClass} max-w-sm`}
        />
        <span className="text-sm text-ink/60">
          {matching.length} {matching.length === 1 ? "ticket" : "tickets"}
        </span>
      </div>

      <div className="hidden rounded-xl border border-line bg-white shadow-sm md:block">
        <table className="w-full table-fixed text-left text-sm">
          <colgroup>
            <col className="w-[5.5rem]" />
            <col />
            <col className="w-[24%]" />
            <col className="w-[6rem]" />
            <col />
          </colgroup>
          <thead className="text-xs tracking-wide text-ink/50 uppercase">
            <tr>
              <SortHeader
                col="purchased"
                label="Date"
                {...{ sort, dir, sortBy }}
              />
              <SortHeader
                col="buyer"
                label="Buyer"
                {...{ sort, dir, sortBy }}
              />
              <th className="px-4 py-2 font-medium">Ticket</th>
              <SortHeader col="pay" label="Amt" {...{ sort, dir, sortBy }} />
              <SortHeader
                col="claimer"
                label="Claimer"
                {...{ sort, dir, sortBy }}
              />
            </tr>
          </thead>
          <tbody className="divide-y divide-line align-top">
            {page.rows.map(({ t, people }) => (
              <tr
                key={t.id}
                onClick={(e) => {
                  // Links and buttons in the row keep their own action.
                  if ((e.target as HTMLElement).closest("a, button")) return;
                  setOpenId(t.id);
                }}
                className="cursor-pointer hover:bg-cream"
              >
                <td className="px-4 py-2 whitespace-nowrap">
                  {monthDay.format(t.createdAt)}
                </td>
                <td className="px-4 py-2 break-words">
                  <PersonLink person={people.buyer} />
                  {!people.holderIsBuyer && people.holder && (
                    <div className="mt-1 text-xs text-ink/60">
                      Held by {personLabel(people.holder)}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="break-words">{t.tier}</span>
                    {t.status !== "paid" && <StatusTag status={t.status} />}
                    {t.test && <TestTag />}
                  </div>
                  <div className="mt-1 truncate text-xs text-ink/60">
                    <span className="font-mono">{t.code}</span>
                    {t.badgeCode && (
                      <span className="font-mono"> · #{t.badgeCode}</span>
                    )}
                    {swagReason(t) && (
                      <span className="text-meeple"> · {swagReason(t)}</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2 tabular-nums">
                  <div className="whitespace-nowrap">
                    {amount(t.amountCents)}
                  </div>
                  {t.couponCode && (
                    <div className="mt-1 truncate font-mono text-xs text-ink/60">
                      {t.couponCode}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2 break-words">
                  <PersonLink person={people.claimer} />
                  {t.claimedAt && (
                    <div className="mt-1 text-xs text-ink/60">
                      Claimed {monthDay.format(t.claimedAt)}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {page.rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink/50">
                  No tickets{q && " match"}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-line rounded-xl border border-line bg-white text-sm shadow-sm md:hidden">
        {page.rows.map((row) => (
          <li key={row.t.id}>
            <button
              type="button"
              onClick={() => setOpenId(row.t.id)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
            >
              <span className="w-10 shrink-0 text-ink/60 tabular-nums">
                {monthDay.format(row.t.createdAt)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  {row.people.buyer ? (
                    personLabel(row.people.buyer)
                  ) : (
                    <span className="text-ink/40">—</span>
                  )}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink/60">
                  {row.t.status !== "paid" && (
                    <StatusTag status={row.t.status} />
                  )}
                  {row.t.test && <TestTag />}
                  <span className="truncate">{row.t.tier}</span>
                </span>
              </span>
              <span className="shrink-0 tabular-nums">
                {amount(row.t.amountCents)}
              </span>
              <ChevronRight
                className="size-4 shrink-0 text-ink/40"
                aria-hidden
              />
            </button>
          </li>
        ))}
        {page.rows.length === 0 && (
          <li className="px-4 py-6 text-center text-ink/50">
            No tickets{q && " match"}.
          </li>
        )}
      </ul>

      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent
          aria-describedby={undefined}
          className="flex max-w-[480px] flex-col gap-4 px-6 py-6"
        >
          {open && (
            <TicketDetail
              ticket={open}
              canEdit={canEdit}
              onReferrer={applyReferrer}
              onBadge={applyBadge}
            />
          )}
        </DialogContent>
      </Dialog>

      <nav className="flex flex-wrap items-center gap-3 text-sm">
        <button
          type="button"
          disabled={page.page <= 1}
          onClick={() => setState((s) => ({ ...s, page: page.page - 1 }))}
          className={`${smallButtonClass} disabled:opacity-40`}
        >
          ← Prev
        </button>
        <span className="text-ink/60">
          Page {page.page} of {page.pages}
        </span>
        <button
          type="button"
          disabled={page.page >= page.pages}
          onClick={() => setState((s) => ({ ...s, page: page.page + 1 }))}
          className={`${smallButtonClass} disabled:opacity-40`}
        >
          Next →
        </button>
        <label className="ml-auto flex items-center gap-2 text-ink/60">
          Per page
          <select
            value={size}
            onChange={(e) => update({ size: Number(e.target.value) })}
            className="appearance-none rounded-md border border-line bg-white bg-no-repeat py-1 pr-8 pl-2 text-ink"
            style={selectStyle}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </nav>
    </div>
  );
}

/** A sortable header: a faint ↕ when idle, ↑/↓ when active. */
function SortHeader({
  col,
  label,
  sort,
  dir,
  sortBy,
}: {
  col: TicketSort;
  label: string;
  sort: TicketSort;
  dir: SortDir;
  sortBy: (col: TicketSort) => void;
}) {
  const active = sort === col;
  const Icon = !active ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      className="px-4 py-2 font-medium"
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => sortBy(col)}
        className={`inline-flex items-center gap-1 uppercase hover:text-navy ${active ? "text-navy" : ""}`}
      >
        {label}
        <Icon
          className={`size-3.5 ${active ? "" : "opacity-40"}`}
          aria-hidden
        />
      </button>
    </th>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-cream/50 uppercase">{label}</dt>
      <dd className="mt-0.5 break-words">{children}</dd>
    </div>
  );
}

function Person({ person }: { person: TicketPerson | null }) {
  if (!person) return <span className="text-cream/40">—</span>;
  const label = personLabel(person);
  return (
    <>
      {person.userId ? (
        <Link
          href={profileHref(person.userId)}
          className="underline underline-offset-2 hover:text-salmon"
        >
          {label}
        </Link>
      ) : (
        label
      )}
      {person.email && person.email !== label && (
        <div className="font-mono text-xs break-all text-cream/60">
          {person.email}
        </div>
      )}
    </>
  );
}

/** Everything the desktop table shows for one ticket, for the phone modal. */
function TicketDetail({
  ticket: { t, people },
  canEdit,
  onReferrer,
  onBadge,
}: {
  ticket: AdminTicket;
  canEdit: boolean;
  onReferrer: (id: string, referredBy: string | null) => void;
  onBadge: (id: string, badgeCode: string | null) => void;
}) {
  return (
    <>
      <DialogTitle className="font-bebas pr-8 text-2xl tracking-wide text-cream">
        {t.tier}
      </DialogTitle>
      {(t.status !== "paid" || t.test) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {t.status !== "paid" && <StatusTag status={t.status} />}
          {t.test && <TestTag />}
        </div>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <Field label="Code">
          <span className="font-mono">{t.code}</span>
        </Field>
        <Field label="Badge">
          {t.badgeCode ? (
            <span className="font-mono">#{t.badgeCode}</span>
          ) : (
            <span className="text-cream/40">—</span>
          )}
        </Field>
        <Field label="Purchased">{shortDate.format(t.createdAt)}</Field>
        <Field label="Amount">
          <span className="tabular-nums">{amount(t.amountCents)}</span>
        </Field>
        <Field label="Coupon">
          {t.couponCode ? (
            <span className="font-mono break-all">{t.couponCode}</span>
          ) : (
            <span className="text-cream/40">—</span>
          )}
        </Field>
        <Field label="Buyer">
          <Person person={people.buyer} />
        </Field>
        <Field label="Claimer">
          <Person person={people.claimer} />
          {t.claimedAt && (
            <div className="text-xs text-cream/60">
              Claimed {monthDay.format(t.claimedAt)}
            </div>
          )}
        </Field>
        <Field label="Holder">
          {people.holderIsBuyer ? (
            <span className="text-cream/60">The buyer</span>
          ) : (
            <Person person={people.holder} />
          )}
        </Field>
        <Field label="Source">
          <span className="capitalize">{t.source}</span>
        </Field>
        <Field label="Referral code">
          {t.referralCode ? (
            <span className="font-mono">{t.referralCode}</span>
          ) : (
            <span className="text-cream/40">—</span>
          )}
        </Field>
        <Field label="Swag">
          {swagReason(t) ?? <span className="text-cream/40">—</span>}
        </Field>
        <Field label="Referred by">
          {t.referredBy ? (
            <span className="font-mono">{t.referredBy}</span>
          ) : (
            <span className="text-cream/40">—</span>
          )}
        </Field>
      </dl>
      {canEdit && (
        <>
          <BadgeEditor
            id={t.id}
            badgeCode={t.badgeCode}
            onChange={(code) => onBadge(t.id, code)}
          />
          <ReferrerEditor
            id={t.id}
            referredBy={t.referredBy}
            onChange={(code) => onReferrer(t.id, code)}
          />
        </>
      )}
    </>
  );
}

/**
 * PUT or DELETE one field of ticket `id` through its /api/admin/tickets route,
 * resolving to the new value or throwing the server's message.
 */
async function editTicket<T>(
  id: string,
  field: string,
  method: "PUT" | "DELETE",
  body: Record<string, string> | undefined,
): Promise<T> {
  const res = await fetch(
    `/api/admin/tickets/${encodeURIComponent(id)}/${field}`,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: body && JSON.stringify(body),
    },
  );
  const data = (await res.json().catch(() => null)) as
    | (Record<string, unknown> & { error?: string })
    | null;
  if (!res.ok || data === null)
    throw new Error(data?.error ?? `Failed (${res.status}).`);
  return data as T;
}

/** Fixes the sticker number on a ticket after the desk, or takes it off. */
function BadgeEditor({
  id,
  badgeCode,
  onChange,
}: {
  id: string;
  badgeCode: string | null;
  onChange: (badgeCode: string | null) => void;
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (method: "PUT" | "DELETE") => {
    setBusy(true);
    setError(null);
    try {
      const data = await editTicket<{ badgeCode: string | null }>(
        id,
        "badge",
        method,
        method === "PUT" ? { badgeCode: code } : undefined,
      );
      onChange(data.badgeCode);
      setCode("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (code) void send("PUT");
      }}
      className="space-y-2 text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={code}
          onChange={(e) =>
            setCode(e.target.value.replace(/\D/g, "").slice(0, 4))
          }
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="Badge code"
          autoComplete="off"
          disabled={busy}
          className={`${fieldClass} max-w-[8rem] font-mono text-sm text-ink`}
        />
        <button
          type="submit"
          disabled={busy || !code}
          className={smallButtonClass}
        >
          {badgeCode ? "Change badge" : "Set badge"}
        </button>
        {badgeCode && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void send("DELETE")}
            className={smallButtonClass}
          >
            Remove badge
          </button>
        )}
      </div>
      {error && <p className="text-salmon">{error}</p>}
    </form>
  );
}

/** Sets or clears a ticket's referrer by the referrer's ticket code. */
function ReferrerEditor({
  id,
  referredBy,
  onChange,
}: {
  id: string;
  referredBy: string | null;
  onChange: (referredBy: string | null) => void;
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (method: "PUT" | "DELETE") => {
    setBusy(true);
    setError(null);
    try {
      const data = await editTicket<{ referredBy: string | null }>(
        id,
        "referral",
        method,
        method === "PUT" ? { referrerCode: code } : undefined,
      );
      onChange(data.referredBy ?? null);
      setCode("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (code.trim()) void send("PUT");
      }}
      className="space-y-2 text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Referrer's ticket code"
          autoCapitalize="characters"
          spellCheck={false}
          disabled={busy}
          className={`${fieldClass} max-w-[14rem] font-mono text-sm text-ink`}
        />
        <button
          type="submit"
          disabled={busy || !code.trim()}
          className={smallButtonClass}
        >
          {referredBy ? "Change" : "Set referrer"}
        </button>
        {referredBy && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void send("DELETE")}
            className={smallButtonClass}
          >
            Remove
          </button>
        )}
      </div>
      {error && <p className="text-salmon">{error}</p>}
    </form>
  );
}
