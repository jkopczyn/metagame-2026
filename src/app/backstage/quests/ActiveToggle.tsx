"use client";

import { useActionState } from "react";
import { setQuestActive, type ToggleState } from "./actions";

/** The list's Active column: one click withdraws or restores a quest. */
export default function ActiveToggle({
  id,
  active,
}: {
  id: string;
  active: boolean;
}) {
  const [state, action, pending] = useActionState<ToggleState, FormData>(
    setQuestActive,
    {},
  );
  return (
    // A form of its own, since the row sits inside the print-selection form.
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={active ? "0" : "1"} />
      <button
        disabled={pending}
        title={active ? "Withdraw this quest" : "Make this quest active"}
        className={`rounded-md border px-2 py-0.5 text-xs transition-colors disabled:opacity-60 ${
          active
            ? "border-moss/40 bg-moss/10 text-moss hover:border-moss"
            : "border-line bg-white text-ink/60 hover:border-navy hover:text-navy"
        }`}
      >
        {active ? "Yes" : "No"}
      </button>
      {state.error && (
        <span role="alert" className="ml-2 text-xs text-meeple">
          {state.error}
        </span>
      )}
    </form>
  );
}
