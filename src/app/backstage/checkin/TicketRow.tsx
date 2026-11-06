"use client";

import { useActionState, useState } from "react";
import { buttonClass, smallButtonClass } from "../ui";
import { undoAction } from "./actions";
import ArriveModal from "./ArriveModal";
import type { DeskTicket } from "./desk";
import { formatBadgeCode } from "@/lib/badge-code";
import type { CheckinState } from "@/lib/checkin";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/v2/components/ui/dialog";

const PILL: Record<CheckinState, { label: string; className: string }> = {
  unpaid: { label: "Unpaid", className: "bg-meeple/10 text-meeple" },
  unclaimed: { label: "Unclaimed", className: "bg-amber-100 text-amber-900" },
  claimed: { label: "Claimed", className: "bg-navy/10 text-navy" },
  checkedIn: { label: "Checked in", className: "bg-moss/15 text-moss" },
};

type Mode = "arrive" | "undo";

const ACTION: Partial<
  Record<CheckinState, { label: string; mode: Mode; className: string }>
> = {
  unclaimed: {
    label: "Claim",
    mode: "arrive",
    className:
      "min-h-11 rounded-lg border-2 border-navy bg-white px-3 py-2 text-sm font-semibold text-navy hover:bg-navy/5",
  },
  claimed: {
    label: "Check in",
    mode: "arrive",
    className: `${buttonClass} min-h-11 w-auto px-3 py-2 text-sm`,
  },
  checkedIn: {
    label: "Undo",
    mode: "undo",
    className: `${smallButtonClass} min-h-11 py-2`,
  },
};

export default function TicketRow({ ticket }: { ticket: DeskTicket }) {
  // The modal keeps the mode it opened in, even once the row's state changes.
  const [mode, setMode] = useState<Mode | null>(null);
  const pill = PILL[ticket.state];
  const action = ACTION[ticket.state];
  const close = () => setMode(null);
  return (
    <div className="flex items-center gap-2 px-3 py-2 sm:gap-3">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-navy">
          {ticket.name}
        </span>
        <span className="block truncate font-mono text-[11px] text-ink/60 sm:text-xs">
          {ticket.subtitle}
        </span>
      </span>
      <span className="w-14 shrink-0 text-right font-mono text-sm text-ink/70">
        {ticket.badge === null ? (
          <span className="font-sans text-[11px] text-ink/40">no badge</span>
        ) : (
          formatBadgeCode(ticket.badge)
        )}
      </span>
      <span
        className={`w-20 shrink-0 rounded-full px-2 py-0.5 text-center text-[11px] font-semibold ${pill.className}`}
      >
        {pill.label}
      </span>
      <span className="w-20 shrink-0 text-right sm:w-24">
        {action && (
          <button
            type="button"
            onClick={() => setMode(action.mode)}
            className={action.className}
          >
            {action.label}
          </button>
        )}
      </span>
      {mode === "undo" && <UndoModal ticket={ticket} onClose={close} />}
      {mode === "arrive" && <ArriveModal ticket={ticket} onClose={close} />}
    </div>
  );
}

function UndoModal({
  ticket,
  onClose,
}: {
  ticket: DeskTicket;
  onClose: () => void;
}) {
  const [state, run, pending] = useActionState(undoAction, {});
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] max-w-[400px] overflow-y-auto border-line bg-white p-5 text-ink"
        showCloseButton={false}
      >
        <form action={run} className="flex flex-col gap-4">
          <input type="hidden" name="paymentId" value={ticket.paymentId} />
          <DialogTitle className="text-lg font-semibold text-navy">
            Undo check-in for {ticket.name}?
          </DialogTitle>
          <DialogDescription className="text-sm text-ink/70">
            {ticket.checkedIn
              ? `Checked in at ${ticket.checkedIn.at} by ${ticket.checkedIn.by}. `
              : ""}
            Their badge number stays on the ticket, so checking them in again is
            one tap.
          </DialogDescription>
          {state.error && (
            <p role="alert" className="text-sm text-meeple">
              {state.error}
            </p>
          )}
          {state.done && (
            <p className="text-sm font-semibold text-moss">
              Undone. They&rsquo;re no longer checked in.
            </p>
          )}
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
                className={`${smallButtonClass} border-meeple py-2.5 text-meeple`}
              >
                {pending ? "Undoing…" : "Yes, undo"}
              </button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
