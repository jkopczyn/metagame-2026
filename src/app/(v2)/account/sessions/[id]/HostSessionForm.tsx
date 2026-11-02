"use client";

import { useActionState, useTransition } from "react";
import {
  addCohost,
  removeCohost,
  saveHostSession,
  type SaveState,
} from "./actions";
import { AGES, CATEGORIES } from "@/lib/schedule";

type Host = { userId: string; name: string; email: string };

const initial: SaveState = {};

const field =
  "w-full rounded-lg border border-line bg-white px-3 py-2 text-base outline-none focus:border-navy";
const label = "flex flex-col gap-1.5 text-sm font-semibold text-ink";

const CATEGORY_LABELS: Record<string, string> = {
  talk: "Talk",
  workshop: "Workshop",
  game: "Game",
  other: "Other",
};
const AGES_LABELS: Record<string, string> = {
  all: "All ages",
  kids: "Primarily for children",
  adults: "Adults only (18+)",
};

function Note({ state }: { state: SaveState }) {
  return (
    <p aria-live="polite" className="min-h-5 text-sm">
      {state.error ? (
        <span className="text-meeple">{state.error}</span>
      ) : state.savedAt ? (
        <span className="text-moss">Saved.</span>
      ) : null}
    </p>
  );
}

export default function HostSessionForm({
  sessionId,
  initial: values,
  rsvpIsCommitment,
  hosts,
  viewerId,
}: {
  sessionId: string;
  initial: Record<string, string>;
  rsvpIsCommitment: boolean;
  hosts: Host[];
  viewerId: string;
}) {
  const [state, save, saving] = useActionState(
    saveHostSession.bind(null, sessionId),
    initial,
  );
  const [addState, add, adding] = useActionState(
    addCohost.bind(null, sessionId),
    initial,
  );
  const [removing, startRemove] = useTransition();

  return (
    <div className="mt-8 flex max-w-[640px] flex-col gap-10">
      <form action={save} className="flex flex-col gap-4">
        <label className={label}>
          Title
          <input
            name="title"
            defaultValue={values.title}
            required
            className={field}
          />
        </label>
        <label className={label}>
          Description
          <textarea
            name="description"
            defaultValue={values.description}
            rows={6}
            className={field}
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={label}>
            Kind
            <select
              name="category"
              defaultValue={values.category}
              className={field}
            >
              <option value="">—</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            Ages
            <select name="ages" defaultValue={values.ages} className={field}>
              <option value="">—</option>
              {AGES.map((a) => (
                <option key={a} value={a}>
                  {AGES_LABELS[a]}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            Most people
            <input
              name="maxCapacity"
              type="number"
              min={1}
              defaultValue={values.maxCapacity}
              className={field}
            />
          </label>
          <label className={label}>
            Fewest people
            <input
              name="minCapacity"
              type="number"
              min={0}
              defaultValue={values.minCapacity}
              className={field}
            />
          </label>
        </div>
        <label className={label}>
          What you need
          <textarea
            name="needs"
            defaultValue={values.needs}
            rows={3}
            className={field}
          />
        </label>
        <label className="flex items-start gap-2.5 text-sm text-ink">
          <input
            type="checkbox"
            name="rsvpIsCommitment"
            defaultChecked={rsvpIsCommitment}
            className="mt-0.5 size-4 accent-meeple"
          />
          <span>
            <span className="font-semibold">RSVP is a commitment</span>
            <span className="block text-ink/60">
              Attendees claim a limited spot people rely on, and confirm before
              they do.
            </span>
          </span>
        </label>
        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-meeple px-5 py-2.5 font-roboto font-semibold text-white transition-colors hover:bg-meeple-dark disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <Note state={state} />
        </div>
      </form>

      <section className="flex flex-col gap-3 border-t border-line pt-8">
        <h2 className="text-base font-semibold text-ink">Hosts</h2>
        <p className="text-sm text-ink/60">
          Anyone you add here can edit this session too.
        </p>
        <ul className="flex flex-col gap-2">
          {hosts.map((h, i) => (
            <li
              key={h.userId}
              className="flex items-center justify-between gap-3 rounded-lg border border-line bg-white px-3 py-2 text-sm"
            >
              <span className="min-w-0">
                <span className="block truncate text-ink">
                  {h.name || h.email}
                  {h.userId === viewerId && " (you)"}
                </span>
                <span className="block truncate text-xs text-ink/50">
                  {i === 0 ? "Lead host" : "Co-host"}
                </span>
              </span>
              {hosts.length > 1 && (
                <button
                  type="button"
                  disabled={removing}
                  onClick={() => {
                    startRemove(async () => {
                      await removeCohost(sessionId, h.userId);
                    });
                  }}
                  className="shrink-0 text-xs text-ink/50 underline underline-offset-2 hover:text-meeple disabled:opacity-60"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
        <form action={add} className="flex flex-col gap-2">
          <label className={label}>
            Add a co-host by email
            <input
              name="email"
              type="email"
              placeholder="them@example.com"
              className={field}
            />
          </label>
          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={adding}
              className="rounded-lg border border-line px-4 py-2 text-sm hover:bg-ink/5 disabled:opacity-60"
            >
              {adding ? "Adding…" : "Add"}
            </button>
            <Note state={addState} />
          </div>
        </form>
      </section>
    </div>
  );
}
