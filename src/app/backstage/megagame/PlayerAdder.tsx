"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { fieldClass, smallButtonClass } from "../ui";
import { findPlayers, lookupPlayer, type PlayerHit } from "./actions";
import CodeEntry from "./CodeEntry";
import { latestRequest } from "./latest";
import ScanCodes from "./ScanCodes";

/**
 * Add a player by badge code, scanned badge or name. Never creates accounts.
 * With `onQuest`, a scanned quest label opens that quest. With `single`, the
 * scanner asks for one badge, for pages that move on after one player.
 */
export default function PlayerAdder({
  onAdd,
  onQuest,
  codeLabel = "Player code",
  single = false,
}: {
  onAdd: (player: PlayerHit) => void;
  onQuest?: (code: string) => void;
  codeLabel?: string;
  single?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PlayerHit[]>([]);
  const [pending, start] = useTransition();
  const [search] = useState(latestRequest);
  const searchId = useId();

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const timer = setTimeout(() => {
      const isCurrent = search.begin();
      start(async () => {
        const res = await findPlayers(q);
        if (!isCurrent()) return;
        if (res.error) setError(res.error);
        setHits(res.players ?? []);
      });
    }, 300);
    return () => {
      clearTimeout(timer);
      search.cancel();
    };
  }, [query, search]);

  const add = (player: PlayerHit) => {
    search.cancel();
    setError(null);
    setQuery("");
    setHits([]);
    onAdd(player);
  };

  return (
    <div className="flex flex-col gap-4">
      <ScanCodes
        label={single ? "Scan a badge" : "Scan badges"}
        bareKind="player"
        onPlayer={add}
        onQuest={onQuest}
        addedMessage={single ? foundMessage : undefined}
      />
      <CodeEntry
        label={codeLabel}
        onCode={async (code) => {
          const res = await lookupPlayer(code);
          if (!res.player) {
            setError(res.error ?? "Lookup failed.");
            return true;
          }
          add(res.player);
          return true;
        }}
      />
      <div className="flex flex-col gap-2">
        <label htmlFor={searchId} className="text-sm font-medium text-ink/80">
          Or search by name
        </label>
        <input
          id={searchId}
          type="search"
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (e.target.value.trim().length < 2) setHits([]);
          }}
          placeholder="At least two letters"
          className={fieldClass}
        />
        {pending && <p className="text-sm text-ink/60">Searching…</p>}
        {!pending && query.trim().length >= 2 && hits.length === 0 && (
          <p className="text-sm text-ink/60">
            Nobody by that name. Players without an account need to sign in at
            /login first.
          </p>
        )}
        {hits.length > 0 && (
          <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-white">
            {hits.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => add(p)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-cream"
                >
                  <Avatar player={p} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-navy">
                      {p.name}
                    </span>
                    {p.pronouns && (
                      <span className="block text-sm text-ink/60">
                        {p.pronouns}
                      </span>
                    )}
                  </span>
                  <span className={smallButtonClass}>Add</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-meeple">
          {error}
        </p>
      )}
    </div>
  );
}

const foundMessage = (name: string) => `Found ${name}.`;

export function Avatar({
  player,
}: {
  player: Pick<PlayerHit, "name" | "imageUrl">;
}) {
  if (player.imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- already avatar-sized
      <img
        src={player.imageUrl}
        alt=""
        className="size-10 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-navy/10 font-semibold text-navy"
    >
      {player.name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
