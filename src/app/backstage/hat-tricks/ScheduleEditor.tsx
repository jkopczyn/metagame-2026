"use client";

import { useActionState, useState } from "react";
import { buttonClass, fieldClass, smallButtonClass } from "../ui";
import { saveScheduleAction } from "./actions";
import { HATS, type HatId } from "@/lib/hat-tricks-hats";
import type { ScheduleDraft } from "@/lib/hat-tricks-schedule";
import { fromPacificWall, toPacificWall } from "@/lib/schedule";

const MAX_HATS = 2;

function HatToggles({
  selected,
  onChange,
}: {
  selected: HatId[];
  onChange: (hats: HatId[]) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
      {HATS.map((hat) => {
        const on = selected.includes(hat.id);
        return (
          <button
            key={hat.id}
            type="button"
            aria-pressed={on}
            title={hat.name}
            disabled={!on && selected.length >= MAX_HATS}
            onClick={() =>
              onChange(
                on
                  ? selected.filter((id) => id !== hat.id)
                  : [...selected, hat.id],
              )
            }
            className={`flex flex-col items-center gap-0.5 rounded-md border p-1 text-[11px] leading-tight text-navy capitalize transition-colors disabled:opacity-40 ${
              on ? "border-2 border-navy bg-navy/5 font-medium" : "border-line"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- static line art */}
            <img src={hat.art} alt="" className="size-8 object-contain" />
            {hat.id}
          </button>
        );
      })}
    </div>
  );
}

/** A new shift starts where the last ended and runs as long as the last did. */
function addShift(draft: ScheduleDraft): ScheduleDraft {
  const last = draft.rows.at(-1);
  const end = fromPacificWall(draft.end);
  const lastStart = last && fromPacificWall(last.start);
  if (!end || !lastStart) {
    return { ...draft, rows: [...draft.rows, { start: draft.end, hats: [] }] };
  }
  const length = Math.max(end.getTime() - lastStart.getTime(), 0);
  return {
    rows: [...draft.rows, { start: draft.end, hats: [] }],
    end: toPacificWall(new Date(end.getTime() + length).toISOString()),
  };
}

function ShiftRows({ initial }: { initial: ScheduleDraft }) {
  const [draft, setDraft] = useState(initial);

  const setRow = (index: number, patch: Partial<ScheduleDraft["rows"][0]>) =>
    setDraft((d) => ({
      ...d,
      rows: d.rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));

  return (
    <>
      <input type="hidden" name="draft" value={JSON.stringify(draft)} />
      {draft.rows.map((row, index) => (
        <div
          key={index}
          className="flex flex-col gap-2 rounded-xl border border-line bg-white p-3"
        >
          <div className="flex items-center gap-2">
            <label
              htmlFor={`shift-${index}`}
              className="shrink-0 text-sm font-medium text-ink/80"
            >
              Shift {index + 1}
            </label>
            <input
              id={`shift-${index}`}
              type="datetime-local"
              value={row.start}
              onChange={(e) => setRow(index, { start: e.target.value })}
              className={`${fieldClass} min-w-0 flex-1`}
            />
            <button
              type="button"
              aria-label={`Remove shift ${index + 1}`}
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  rows: d.rows.filter((_, i) => i !== index),
                }))
              }
              className={`${smallButtonClass} shrink-0`}
            >
              Remove
            </button>
          </div>
          <HatToggles
            selected={row.hats}
            onChange={(hats) => setRow(index, { hats })}
          />
        </div>
      ))}

      <button
        type="button"
        onClick={() => setDraft(addShift)}
        className={`${smallButtonClass} self-start py-2`}
      >
        Add shift
      </button>

      {draft.rows.length > 0 && (
        <div className="flex flex-col gap-1">
          <label
            htmlFor="schedule-end"
            className="text-sm font-medium text-ink/80"
          >
            Last shift ends
          </label>
          <input
            id="schedule-end"
            type="datetime-local"
            value={draft.end}
            onChange={(e) => setDraft((d) => ({ ...d, end: e.target.value }))}
            className={fieldClass}
          />
        </div>
      )}
    </>
  );
}

export default function ScheduleEditor({
  initial,
  version,
}: {
  initial: ScheduleDraft;
  version: number;
}) {
  const [state, run, pending] = useActionState(saveScheduleAction, {});

  return (
    <form action={run} className="flex flex-col gap-3">
      <input type="hidden" name="version" value={version} />
      <p className="text-sm text-ink/70">
        Times are Pacific. Each shift runs until the next one starts. Scores
        recalculate from whatever is saved here. With no shifts, only the pirate
        tricorn can be stolen, at any time.
      </p>
      {/* Remounts on save, to show the shifts as stored: in time order. */}
      <ShiftRows key={version} initial={initial} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Saving…" : "Save schedule"}
      </button>
      {state.error && (
        <p role="alert" className="text-sm text-meeple">
          {state.error}
        </p>
      )}
      {state.done && <p className="text-sm text-navy">{state.done}</p>}
    </form>
  );
}
