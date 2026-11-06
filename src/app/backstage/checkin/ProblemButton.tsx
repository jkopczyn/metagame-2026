"use client";

import { useActionState, useId, useState } from "react";
import { buttonClass, fieldClass, smallButtonClass } from "../ui";
import { reportProblem } from "./actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/v2/components/ui/dialog";

/** Posts a note to Discord with the desk context: website-errors or staff-issues. */
export default function ProblemButton({ q }: { q: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${smallButtonClass} min-h-11 py-2`}
      >
        Report issue
      </button>
      {open && <ReportModal q={q} onClose={() => setOpen(false)} />}
    </>
  );
}

function ReportModal({ q, onClose }: { q: string; onClose: () => void }) {
  const [state, run, pending] = useActionState(reportProblem, {});
  const [kind, setKind] = useState<"technical" | "human" | null>(null);
  const id = useId();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] max-w-[440px] overflow-y-auto border-line bg-white p-5 text-ink"
        showCloseButton={false}
      >
        <form action={run} className="flex flex-col gap-4">
          <input type="hidden" name="q" value={q} />
          <div className="flex flex-col gap-1">
            <DialogTitle className="text-lg font-semibold text-navy">
              Report an issue
            </DialogTitle>
            <DialogDescription className="text-sm text-ink/70">
              Sends a Discord notification to the team, with your name and what
              you searched for.
            </DialogDescription>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium text-ink/80">
              What kind of issue?
            </legend>
            {(
              [
                {
                  value: "technical",
                  label: "Technical issue",
                  hint: "The site is wrong or broken. Pings Brian in #website-errors.",
                },
                {
                  value: "human",
                  label: "Human issue",
                  hint: "Trouble with a person or the desk. Pings on-site staff in #staff-issues.",
                },
              ] as const
            ).map((o) => (
              <label
                key={o.value}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 ${
                  kind === o.value
                    ? "border-navy bg-navy/5"
                    : "border-line bg-white hover:border-navy"
                }`}
              >
                <input
                  type="radio"
                  name="kind"
                  value={o.value}
                  required
                  checked={kind === o.value}
                  onChange={() => setKind(o.value)}
                  className="mt-1 accent-navy"
                />
                <span className="min-w-0">
                  <span className="block font-medium text-navy">{o.label}</span>
                  <span className="block text-xs text-ink/60">{o.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="flex flex-col gap-1">
            <label htmlFor={id} className="text-sm font-medium text-ink/80">
              What&rsquo;s going on?
            </label>
            <textarea
              id={id}
              name="text"
              required
              rows={4}
              maxLength={1200}
              placeholder="What happened? Who's in front of you?"
              className={fieldClass}
            />
          </div>
          {state.error && (
            <p role="alert" className="text-sm text-meeple">
              {state.error}
            </p>
          )}
          {state.done && <p className="text-sm text-moss">{state.done}</p>}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className={`${smallButtonClass} py-2.5`}
            >
              {state.done ? "Close" : "Cancel"}
            </button>
            {!state.done && (
              <button
                type="submit"
                disabled={pending || kind === null}
                className={`${buttonClass} w-auto py-2.5 disabled:cursor-not-allowed disabled:opacity-40`}
              >
                {pending ? "Sending…" : "Send"}
              </button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
