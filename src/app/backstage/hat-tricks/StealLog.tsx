"use client";

import { useActionState, useState } from "react";
import { smallButtonClass } from "../ui";
import { deleteStealAction } from "./actions";
import { formatShiftTime } from "@/lib/hat-tricks-format";
import { hatById } from "@/lib/hat-tricks-hats";
import type { StealLogRow } from "@/lib/hat-tricks-store";

function DeleteSteal({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [state, run, pending] = useActionState(deleteStealAction, {});

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={smallButtonClass}
      >
        Delete
      </button>
    );
  }
  return (
    <form action={run} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className={smallButtonClass}>
        {pending ? "Deleting…" : "Yes, delete"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className={smallButtonClass}
      >
        Cancel
      </button>
      {state.error && (
        <p role="alert" className="w-full text-sm text-meeple">
          {state.error}
        </p>
      )}
    </form>
  );
}

export default function StealLog({ steals }: { steals: StealLogRow[] }) {
  if (steals.length === 0) {
    return <p className="text-sm text-ink/60">No steals recorded yet.</p>;
  }
  return (
    <ul className="divide-y divide-line rounded-xl border border-line bg-white">
      {steals.map((steal) => {
        const hat = hatById(steal.hatId);
        return (
          <li
            key={steal.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:px-4"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- static line art */}
            <img src={hat.art} alt="" className="size-9 object-contain" />
            <div className="min-w-0 flex-1 basis-40">
              <p className="truncate font-medium text-navy">{steal.thief}</p>
              <p className="text-sm text-ink/70">
                {hat.name} · {formatShiftTime(steal.stolenAt)}
                {steal.recordedBy && ` · by ${steal.recordedBy}`}
              </p>
            </div>
            <DeleteSteal id={steal.id} />
          </li>
        );
      })}
    </ul>
  );
}
