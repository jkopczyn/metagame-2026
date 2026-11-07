"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { fieldClass, smallButtonClass } from "../ui";
import { latestRequest } from "../megagame/latest";
import { CHECKIN_MIN_CHARS, type CheckinAccount } from "@/lib/checkin";

function AccountLine({ name, email }: { name: string; email: string }) {
  return (
    <span className="min-w-0 flex-1 text-left">
      <span className="block truncate font-medium text-navy">{name}</span>
      <span className="block truncate font-mono text-xs text-ink/60">
        {email}
      </span>
    </span>
  );
}

/**
 * Picks the account a ticket is for: the one on the purchase, or one searched
 * for. The desk never makes accounts; people sign in themselves first.
 */
export default function AccountPicker({
  suggested,
  buyer,
  search: findAccounts,
  onPick,
}: {
  suggested: CheckinAccount | null;
  /** The purchase's name and email when the buyer has no account yet. */
  buyer: { name: string | null; email: string | null } | null;
  /** A server action gated on the calling tool's own permission. */
  search: (
    query: string,
  ) => Promise<{ accounts?: CheckinAccount[]; error?: string }>;
  onPick: (account: CheckinAccount) => void;
}) {
  const [searching, setSearching] = useState(
    suggested === null && buyer === null,
  );
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CheckinAccount[]>([]);
  const [searchedFor, setSearchedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [latest] = useState(latestRequest);
  const searchId = useId();

  useEffect(() => {
    const q = query.trim();
    if (q.length < CHECKIN_MIN_CHARS) return;
    const timer = setTimeout(() => {
      const isCurrent = latest.begin();
      start(async () => {
        const res = await findAccounts(q);
        if (!isCurrent()) return;
        setError(res.error ?? null);
        setHits(res.accounts ?? []);
        setSearchedFor(res.error ? null : q);
      });
    }, 300);
    return () => {
      clearTimeout(timer);
      latest.cancel();
    };
  }, [query, latest, findAccounts]);

  const pick = (account: CheckinAccount, label: string, primary = false) => (
    <button
      type="button"
      onClick={() => onPick(account)}
      className={`flex w-full items-center gap-3 rounded-lg bg-white px-3 py-3 ${
        primary
          ? "border-2 border-navy hover:bg-navy/5"
          : "border border-line hover:border-navy"
      }`}
    >
      <AccountLine name={account.name} email={account.email} />
      <span className="shrink-0 text-sm font-semibold text-navy">{label}</span>
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      {suggested
        ? pick(suggested, "Use existing account", true)
        : buyer && (
            <div className="flex flex-col gap-2 rounded-lg border border-line bg-white px-3 py-3">
              <div className="flex items-center gap-3">
                <AccountLine
                  name={buyer.name ?? buyer.email ?? ""}
                  email={
                    buyer.name ? (buyer.email ?? "") : "no name on the purchase"
                  }
                />
                <span className="shrink-0 text-xs text-ink/60">no account</span>
              </div>
              <p className="text-sm text-ink/70">
                If being claimed by this purchaser: they sign in at
                metagame.games/login first (one code to that email), then search
                for them below.
              </p>
            </div>
          )}
      {!searching ? (
        <button
          type="button"
          onClick={() => setSearching(true)}
          className={`${smallButtonClass} self-start py-2`}
        >
          {suggested
            ? "Someone else is claiming this ticket…"
            : "Search accounts…"}
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          <label htmlFor={searchId} className="text-sm font-medium text-ink/80">
            Search accounts by name or email
          </label>
          <input
            id={searchId}
            type="search"
            autoFocus
            autoComplete="off"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (e.target.value.trim().length < CHECKIN_MIN_CHARS) setHits([]);
            }}
            placeholder="At least two letters"
            className={fieldClass}
          />
          {pending && <p className="text-sm text-ink/60">Searching…</p>}
          {!pending &&
            searchedFor !== null &&
            searchedFor === query.trim() &&
            hits.length === 0 && (
              <p className="text-sm text-ink/60">
                No account matches. They need to sign in at metagame.games/login
                first, then search again.
              </p>
            )}
          {hits.map((a) => (
            <div key={a.id}>{pick(a, "Pick")}</div>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-meeple">
          {error}
        </p>
      )}
    </div>
  );
}
