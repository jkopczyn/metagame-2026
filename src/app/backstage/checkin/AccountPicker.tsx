"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { fieldClass, smallButtonClass } from "../ui";
import { findAccounts, mintAccount } from "./actions";
import { latestRequest } from "../megagame/latest";
import { CHECKIN_MIN_CHARS, type CheckinAccount } from "@/lib/checkin";

function AccountLine({ account }: { account: CheckinAccount }) {
  return (
    <span className="min-w-0 flex-1 text-left">
      <span className="block truncate font-medium text-navy">
        {account.name}
      </span>
      <span className="block truncate font-mono text-xs text-ink/60">
        {account.email}
      </span>
    </span>
  );
}

/** Picks the account a ticket is for: the one on the purchase, or one searched for. */
export default function AccountPicker({
  suggested,
  prefill,
  onPick,
}: {
  suggested: CheckinAccount | null;
  /** From the purchase, for a new account. */
  prefill: { name: string | null; email: string | null };
  onPick: (account: CheckinAccount) => void;
}) {
  const purchaser = prefill.email !== null;
  const [searching, setSearching] = useState(suggested === null && !purchaser);
  // Who the new-account form is for: the purchaser, or someone else (blank).
  const [minting, setMinting] = useState<"purchaser" | "other" | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CheckinAccount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [search] = useState(latestRequest);
  const searchId = useId();

  useEffect(() => {
    const q = query.trim();
    if (q.length < CHECKIN_MIN_CHARS) return;
    const timer = setTimeout(() => {
      const isCurrent = search.begin();
      start(async () => {
        const res = await findAccounts(q);
        if (!isCurrent()) return;
        setError(res.error ?? null);
        setHits(res.accounts ?? []);
      });
    }, 300);
    return () => {
      clearTimeout(timer);
      search.cancel();
    };
  }, [query, search]);

  const pick = (account: CheckinAccount) => (
    <button
      type="button"
      onClick={() => onPick(account)}
      className="flex w-full items-center gap-3 rounded-lg border border-line bg-white px-3 py-3 hover:border-navy"
    >
      <AccountLine account={account} />
      <span className="shrink-0 text-sm font-semibold text-navy">Pick</span>
    </button>
  );

  if (minting) {
    return (
      <MintForm
        prefill={
          minting === "purchaser" ? prefill : { name: null, email: null }
        }
        onPick={onPick}
        onBack={() => setMinting(null)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {suggested
        ? pick(suggested)
        : purchaser && (
            <button
              type="button"
              onClick={() => setMinting("purchaser")}
              className="flex w-full items-center gap-3 rounded-lg border-2 border-navy bg-white px-3 py-3 hover:bg-navy/5"
            >
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate font-medium text-navy">
                  {prefill.name ?? prefill.email}
                </span>
                <span className="block truncate font-mono text-xs text-ink/60">
                  {prefill.name ? prefill.email : "no name on the purchase"}
                </span>
              </span>
              <span className="shrink-0 text-right text-sm font-semibold text-navy">
                It&rsquo;s them
                <span className="block text-xs font-normal text-ink/60">
                  makes their account
                </span>
              </span>
            </button>
          )}
      {!searching ? (
        <button
          type="button"
          onClick={() => setSearching(true)}
          className={`${smallButtonClass} self-start py-2`}
        >
          Someone else is claiming this ticket…
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
            query.trim().length >= CHECKIN_MIN_CHARS &&
            hits.length === 0 && (
              <p className="text-sm text-ink/60">
                No account matches. They need to sign in at metagame.games/login
                first, then search again.
              </p>
            )}
          {hits.map((a) => (
            <div key={a.id}>{pick(a)}</div>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-meeple">
          {error}
        </p>
      )}
      {searching && (
        <button
          type="button"
          onClick={() => setMinting("other")}
          className={`${smallButtonClass} self-start py-2`}
        >
          They have no account yet…
        </button>
      )}
    </div>
  );
}

function MintForm({
  prefill,
  onPick,
  onBack,
}: {
  prefill: { name: string | null; email: string | null };
  onPick: (account: CheckinAccount) => void;
  onBack: () => void;
}) {
  const [name, setName] = useState(prefill.name ?? "");
  const [email, setEmail] = useState(prefill.email ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const nameId = useId();
  const emailId = useId();
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-white p-3">
      <label htmlFor={nameId} className="text-sm font-medium text-ink/80">
        Name, as it should read on the badge
      </label>
      <input
        id={nameId}
        autoFocus
        autoComplete="off"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={fieldClass}
      />
      <label htmlFor={emailId} className="text-sm font-medium text-ink/80">
        Email they&rsquo;ll sign in with
      </label>
      <input
        id={emailId}
        type="email"
        inputMode="email"
        autoComplete="off"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className={fieldClass}
      />
      <p className="text-xs text-ink/60">
        Read the email back to them. They get a sign-in link there.
      </p>
      {error && (
        <p role="alert" className="text-sm text-meeple">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={pending || !name.trim() || !email.trim()}
        onClick={() =>
          start(async () => {
            const res = await mintAccount({ name, email });
            if (res.account) onPick(res.account);
            else setError(res.error ?? "Couldn't create the account.");
          })
        }
        className={`${smallButtonClass} self-start py-2 font-semibold text-navy disabled:opacity-40`}
      >
        {pending ? "Creating…" : "Create account & pick"}
      </button>
      <button
        type="button"
        onClick={onBack}
        className="self-start text-sm text-ink/60 underline-offset-2 hover:underline"
      >
        Back to search
      </button>
    </div>
  );
}
