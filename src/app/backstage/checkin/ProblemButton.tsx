"use client";

import { useActionState, useId, useState } from "react";
import { buttonClass, fieldClass, smallButtonClass } from "../ui";
import { reportProblem } from "./actions";
import { Dialog, DialogContent, DialogTitle } from "@/v2/components/ui/dialog";

/** Posts a note to the website-errors Discord channel with the desk context. */
export default function ProblemButton({
  q,
  paymentId,
}: {
  q: string;
  paymentId?: string;
}) {
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
      {open && (
        <ReportModal
          q={q}
          paymentId={paymentId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ReportModal({
  q,
  paymentId,
  onClose,
}: {
  q: string;
  paymentId?: string;
  onClose: () => void;
}) {
  const [state, run, pending] = useActionState(reportProblem, {});
  const id = useId();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] max-w-[440px] overflow-y-auto border-line bg-white p-5 text-ink"
        showCloseButton={false}
      >
        <form action={run} className="flex flex-col gap-4">
          <input type="hidden" name="q" value={q} />
          {paymentId && (
            <input type="hidden" name="paymentId" value={paymentId} />
          )}
          <DialogTitle className="text-lg font-semibold text-navy">
            Report an issue
          </DialogTitle>
          <div className="flex flex-col gap-1">
            <label htmlFor={id} className="text-sm font-medium text-ink/80">
              What&rsquo;s going on?
            </label>
            <textarea
              id={id}
              name="text"
              required
              autoFocus
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
                disabled={pending}
                className={`${buttonClass} w-auto py-2.5`}
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
