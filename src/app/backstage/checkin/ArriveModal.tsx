"use client";

import { useActionState, useId, useRef, useState } from "react";
import { buttonClass, fieldClass, smallButtonClass } from "../ui";
import AccountPicker from "./AccountPicker";
import { arriveAction } from "./actions";
import type { DeskTicket } from "./desk";
import { formatBadgeCode } from "@/lib/badge-code";
import type { CheckinAccount } from "@/lib/checkin";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/v2/components/ui/dialog";

/** Everything an arriving attendee needs: who the ticket is for, their sticker, check in. */
export default function ArriveModal({
  ticket,
  onClose,
}: {
  ticket: DeskTicket;
  onClose: () => void;
}) {
  // Fixed at open: the row's state moves underneath once the action lands.
  const [claiming] = useState(ticket.state === "unclaimed");
  const [forUser, setForUser] = useState<CheckinAccount | null>(
    ticket.suggested,
  );
  const [override, setOverride] = useState(false);
  const [badge, setBadge] = useState("");
  const [state, run, pending] = useActionState(arriveAction, {});
  const badgeId = useId();
  const existing = ticket.badge === null ? null : formatBadgeCode(ticket.badge);
  const needsPick = claiming && forUser === null;
  const typing = existing === null || override;
  const ready = !needsPick && (!typing || badge.length > 0);
  const submit = useRef<HTMLButtonElement>(null);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] max-w-[440px] overflow-y-auto border-line bg-white p-5 text-ink"
        showCloseButton={false}
        // With a sticker on record, Enter should check in, not open the override.
        onOpenAutoFocus={(e) => {
          if (typing) return;
          e.preventDefault();
          submit.current?.focus();
        }}
      >
        <form action={run} className="flex flex-col gap-4">
          <input type="hidden" name="paymentId" value={ticket.paymentId} />
          {forUser && (
            <input type="hidden" name="forUserId" value={forUser.id} />
          )}
          <div className="flex flex-col gap-1">
            <DialogTitle className="text-lg font-semibold text-navy">
              {claiming
                ? forUser
                  ? `Claim for ${forUser.name}`
                  : "Who is this ticket for?"
                : ticket.name}
            </DialogTitle>
            <DialogDescription className="font-mono text-xs text-ink/60">
              {ticket.tier} ticket
              {ticket.purchaserEmail
                ? ` · bought by ${ticket.purchaserEmail}`
                : ""}
            </DialogDescription>
          </div>

          {claiming &&
            (forUser === null ? (
              <AccountPicker
                suggested={ticket.suggested}
                buyer={
                  ticket.buyerNeedsAccount
                    ? {
                        name: ticket.purchaserName,
                        email: ticket.purchaserEmail,
                      }
                    : null
                }
                onPick={setForUser}
              />
            ) : (
              <div className="flex items-center gap-3 rounded-lg border border-navy/30 bg-navy/5 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-navy">
                    {forUser.name}
                  </span>
                  <span className="block truncate font-mono text-xs text-ink/60">
                    {forUser.email}
                  </span>
                </span>
                {!state.done && (
                  <button
                    type="button"
                    onClick={() => setForUser(null)}
                    className={smallButtonClass}
                  >
                    Change
                  </button>
                )}
              </div>
            ))}

          {!needsPick && !state.done && (
            <div className="flex flex-col gap-2">
              {typing ? (
                <>
                  <label
                    htmlFor={badgeId}
                    className="text-sm font-medium text-ink/80"
                  >
                    {override ? "New badge code" : "Sticker number"}
                  </label>
                  <input
                    id={badgeId}
                    name="badge"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={5}
                    autoComplete="off"
                    autoFocus
                    value={badge === "" ? "" : badge.padStart(4, "0")}
                    onChange={(e) =>
                      // Calculator entry: digits shift in from the right.
                      setBadge(
                        e.target.value
                          .replace(/\D/g, "")
                          .replace(/^0+/, "")
                          .slice(-4),
                      )
                    }
                    placeholder="0000"
                    className={`${fieldClass} w-32 py-3 text-center font-mono text-2xl tracking-widest`}
                  />
                  {override && (
                    <p className="text-xs text-ink/60">
                      Only if they lost badge {existing}. Type the code on the
                      replacement badge; {existing} stops working.
                    </p>
                  )}
                </>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm text-ink/80">
                    Badge code:{" "}
                    <span className="font-mono text-lg">{existing}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setOverride(true)}
                    className={smallButtonClass}
                  >
                    Issue a new badge code
                  </button>
                </div>
              )}
            </div>
          )}

          {state.error && (
            <p role="alert" className="text-sm text-meeple">
              {state.error}
            </p>
          )}
          {state.done && (
            <p className="text-sm font-semibold text-moss">
              Checked in. Hand them badge{" "}
              {state.badge === undefined
                ? existing
                : formatBadgeCode(state.badge)}{" "}
              and a swag bag.
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
            {!state.done && !needsPick && (
              <button
                ref={submit}
                type="submit"
                disabled={pending || !ready}
                className={`${buttonClass} w-auto disabled:cursor-not-allowed disabled:opacity-40`}
              >
                {pending
                  ? "Working…"
                  : claiming
                    ? "Claim & check in"
                    : "Check in"}
              </button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
