"use client";

import { useActionState, useState } from "react";
import { deleteQuest, type DeleteState } from "./actions";
import { fieldClass, smallButtonClass } from "../ui";
import { normalizeTicketCode } from "@/lib/ticket-code-format";

/** Deletes a quest once its code is typed back; one with progress can only be withdrawn. */
export default function DeleteQuestForm({
  id,
  code,
}: {
  id: string;
  code: string;
}) {
  const [state, action, pending] = useActionState<DeleteState, FormData>(
    deleteQuest,
    {},
  );
  const [typed, setTyped] = useState("");
  const matches = normalizeTicketCode(typed) === code;
  return (
    <details className="rounded-xl border border-line bg-white">
      <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-ink/70">
        Delete this quest
      </summary>
      <form
        action={action}
        className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3"
      >
        <input type="hidden" name="id" value={id} />
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={`Type ${code} to confirm`}
          className={`${fieldClass} w-56 font-mono`}
          autoComplete="off"
        />
        <button
          disabled={!matches || pending}
          className={`${smallButtonClass} border-meeple text-meeple hover:bg-meeple hover:text-white`}
        >
          Delete quest
        </button>
        <span className="text-xs text-ink/60">
          Only for a quest nobody has completed; otherwise untick Active.
        </span>
        {state.error && (
          <p role="alert" className="w-full text-sm text-meeple">
            {state.error}
          </p>
        )}
      </form>
    </details>
  );
}
