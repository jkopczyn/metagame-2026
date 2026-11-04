"use client";

import { useState, useTransition } from "react";
import { createOwnKey, revokeOwnKey } from "./own-actions";
import { buttonClass, fieldClass, smallButtonClass } from "../ui";
import { MintedKeyDialog } from "@/components/MintedKeyDialog";
import { cn } from "@/v2/lib/utils";

export type OwnKeyRow = {
  id: string;
  label: string;
  start: string;
  enabled: boolean;
  created: string;
  lastUsed: string | null;
};

/** The viewer's own keys: anyone holding api_keys.self, managers included. */
export default function OwnKeysPanel({ rows }: { rows: OwnKeyRow[] }) {
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<string | null>(null);
  const [creating, startCreate] = useTransition();
  const [revoking, startRevoke] = useTransition();
  const pending = creating || revoking;
  const [revokingId, setRevokingId] = useState<string | null>(null);

  return (
    <section className="max-w-xl space-y-3 rounded-xl border border-line bg-white p-5 shadow-sm">
      <h2 className="font-bebas text-xl tracking-wide text-navy">Your keys</h2>
      <p className="text-sm text-ink/60">
        A key acts as your account: anything you can do here, a request carrying
        the key can do too.
      </p>
      <form
        className="flex items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const label = String(new FormData(form).get("label") ?? "");
          startCreate(async () => {
            const result = await createOwnKey(label);
            setError(result.error ?? null);
            if (result.key) {
              setMinted(result.key);
              form.reset();
            }
          });
        }}
      >
        <input
          name="label"
          aria-label="Label"
          required
          maxLength={80}
          placeholder="metagame-claude-code"
          className={cn(fieldClass, "min-w-0 flex-1")}
        />
        <button
          type="submit"
          disabled={pending}
          className={cn(buttonClass, "w-auto whitespace-nowrap")}
        >
          {creating ? "Creating…" : "Create"}
        </button>
      </form>
      {error && (
        <p aria-live="polite" className="text-sm text-meeple">
          {error}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-ink/50">You don’t have any keys yet.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {rows.map((k) => (
            <li
              key={k.id}
              className={`flex items-center gap-3 py-2 ${k.enabled ? "" : "text-ink/50"}`}
            >
              <span className="font-semibold text-ink">{k.label || "—"}</span>
              <span className="font-mono text-xs text-ink/50">{k.start}…</span>
              <span className="min-w-0 flex-1 truncate text-xs text-ink/60">
                {k.created}
                {k.lastUsed ? ` · used ${k.lastUsed}` : ""}
              </span>
              <button
                type="button"
                disabled={pending}
                className={`${smallButtonClass} hover:border-meeple hover:text-meeple`}
                onClick={() => {
                  setRevokingId(k.id);
                  startRevoke(async () => {
                    setError((await revokeOwnKey(k.id)).error ?? null);
                  });
                }}
              >
                {revoking && revokingId === k.id ? "Revoking…" : "Revoke"}
              </button>
            </li>
          ))}
        </ul>
      )}
      <MintedKeyDialog value={minted} onClose={() => setMinted(null)} />
    </section>
  );
}
