"use client";

import { useActionState, useState } from "react";
import { fieldClass, smallButtonClass } from "../ui";
import type { UndoState } from "./actions";

/** Undo with an optional reason, behind a second tap. */
export default function UndoForm({
  action,
  ids,
  label = "Undo",
}: {
  action: (prev: UndoState, formData: FormData) => Promise<UndoState>;
  ids: readonly string[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, run, pending] = useActionState(action, {});

  if (state.done) return <span className="text-sm text-ink/60">Undone</span>;
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={smallButtonClass}
      >
        {label}
      </button>
    );
  }
  return (
    <form action={run} className="flex w-full flex-col gap-2">
      {ids.map((id) => (
        <input key={id} type="hidden" name="id" value={id} />
      ))}
      <input
        name="reason"
        maxLength={500}
        placeholder="Reason (optional)"
        aria-label="Reason for undoing"
        className={fieldClass}
      />
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={smallButtonClass}>
          {pending ? "Undoing…" : `Yes, ${label.toLowerCase()}`}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className={smallButtonClass}
        >
          Cancel
        </button>
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-meeple">
          {state.error}
        </p>
      )}
    </form>
  );
}
