"use client";

import { useActionState, useState, useTransition } from "react";
import {
  claim,
  claimMine,
  unclaimMine,
  type ClaimState,
  type UnclaimState,
} from "./actions";
import { CheckIcon, CopyIcon, LinkIcon } from "lucide-react";
import { Button } from "@/v2/components/ui/button";
import PinInput from "@/v2/components/auth/PinInput";
import {
  TICKET_CODE_LENGTH,
  normalizeTicketCode,
} from "@/lib/ticket-code-format";
import type { TicketView } from "@/lib/ticket-view";
import { useCopy } from "@/v2/lib/use-copy";

/** Held by the viewer, paid, and nobody's claimed it yet. */
const shareable = (t: TicketView) =>
  t.code !== null && !t.claimed && t.status === "paid";

function badge(t: TicketView): { text: string; tone: string } {
  if (t.status !== "paid")
    return { text: t.status, tone: "bg-tan/30 text-ink" };
  if (t.mine) return { text: "Yours", tone: "bg-moss/20 text-moss" };
  if (t.transferred)
    return { text: "Transferred", tone: "bg-navy/10 text-navy" };
  if (t.claimed) return { text: "Claimed", tone: "bg-navy/10 text-navy" };
  return { text: "Unclaimed", tone: "bg-meeple/10 text-meeple" };
}

/** The holder's code, to copy and pass on to whoever's attending. */
function ShareCode({ code }: { code: string }) {
  return (
    <span className="flex items-center gap-1.5 text-sm text-ink/70">
      Share code to transfer:
      <span className="font-mono text-ink">{code}</span>
      <CopyButton text={() => code} label="Copy code" Icon={CopyIcon} />
    </span>
  );
}

/** A small icon button that reports its copy state. */
function CopyButton({
  text,
  label,
  Icon,
}: {
  text: () => string;
  label: string;
  Icon: typeof CopyIcon;
}) {
  const { status, copy } = useCopy();
  const Shown = status === "copied" ? CheckIcon : Icon;
  return (
    <button
      type="button"
      onClick={() => copy(text())}
      aria-label={status === "copied" ? "Copied" : label}
      title={status === "failed" ? "Couldn't copy" : label}
      className="rounded p-1 text-navy/70 hover:bg-navy/10 hover:text-navy"
    >
      <Shown className={`size-4 ${status === "failed" ? "text-meeple" : ""}`} />
    </button>
  );
}

/**
 * The ticket's referral code and invite link. A friend who buys with it pays
 * the Family & Friends price, and both tickets count for the swag.
 */
function InviteCode({ code }: { code: string }) {
  const href = `/invite/${code}`;
  return (
    <span className="flex basis-full flex-wrap items-center gap-x-1.5 gap-y-1 pt-1 text-sm text-ink/70">
      Invite a friend:
      <span className="font-mono text-ink">{href}</span>
      <CopyButton
        text={() => `${window.location.origin}${href}`}
        label="Copy invite link"
        Icon={LinkIcon}
      />
    </span>
  );
}

export default function TicketsPanel({ tickets }: { tickets: TicketView[] }) {
  const [state, action, pending] = useActionState<ClaimState, FormData>(
    claim,
    {},
  );
  const [claiming, startClaim] = useTransition();
  // Which ticket's Claim was pressed, so only that button shows progress.
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [mineState, setMineState] = useState<ClaimState>({});
  const [unclaiming, startUnclaim] = useTransition();
  // The ticket whose Unclaim is asking for confirmation.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [unclaimState, setUnclaimState] = useState<UnclaimState>({});
  // One admission per person, so offer it only until they hold a ticket.
  const holdsOne = tickets.some((t) => t.mine);

  return (
    <section className="mt-12 flex max-w-[960px] flex-col gap-4">
      <h2 className="font-grotesk text-2xl font-bold text-navy">Tickets</h2>
      {tickets.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line bg-white">
          {tickets.map((t) => {
            const b = badge(t);
            return (
              <li
                key={t.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3"
              >
                <span className="text-base font-semibold text-ink">
                  {t.tier}
                  {t.test && (
                    <span className="ml-2 text-xs font-normal text-ink/50">
                      test
                    </span>
                  )}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-semibold ${b.tone}`}
                >
                  {b.text}
                </span>
                {t.mine && (
                  <span className="text-sm text-ink/70">
                    Badge{" "}
                    <span className="font-mono text-ink">
                      {t.badgeCode ? `#${t.badgeCode}` : "—"}
                    </span>
                  </span>
                )}
                {shareable(t) && !holdsOne && (
                  <Button
                    size="sm"
                    // The others wait too, so one click can't claim two.
                    disabled={claiming}
                    onClick={() => {
                      setClaimingId(t.id);
                      startClaim(async () =>
                        setMineState(await claimMine(t.id)),
                      );
                    }}
                    className="bg-moss px-3 py-1 hover:bg-moss/85"
                  >
                    {claiming && claimingId === t.id ? "Claiming…" : "Claim"}
                  </Button>
                )}
                {shareable(t) && (
                  <span className="ml-auto">
                    <ShareCode code={t.code!} />
                  </span>
                )}
                {t.mine && t.status === "paid" && confirmingId !== t.id && (
                  <span className="ml-auto flex items-center gap-3">
                    <span className="text-sm text-ink/60">
                      Unclaim this ticket to pass it on to someone else.
                    </span>
                    <button
                      type="button"
                      disabled={unclaiming}
                      onClick={() => setConfirmingId(t.id)}
                      className="rounded border border-line px-3 py-1 text-sm font-semibold text-navy hover:border-navy disabled:opacity-60"
                    >
                      Unclaim
                    </button>
                  </span>
                )}
                {t.mine && confirmingId === t.id && (
                  <span className="flex basis-full flex-wrap items-center gap-3 pt-1">
                    <span className="text-sm text-ink/70">
                      Unclaim this ticket? You&apos;ll keep it with a new code,
                      so you can pass it on or claim it again. The old code
                      stops working.
                    </span>
                    <Button
                      size="sm"
                      disabled={unclaiming}
                      onClick={() =>
                        startUnclaim(async () => {
                          setUnclaimState(await unclaimMine(t.id));
                          setConfirmingId(null);
                        })
                      }
                      className="px-3 py-1"
                    >
                      {unclaiming ? "Unclaiming…" : "Unclaim ticket"}
                    </Button>
                    <button
                      type="button"
                      disabled={unclaiming}
                      onClick={() => setConfirmingId(null)}
                      className="text-sm font-semibold text-navy hover:underline"
                    >
                      Cancel
                    </button>
                  </span>
                )}
                {t.referredBy && (
                  <span className="basis-full text-sm text-ink/60">
                    Referred by {t.referredBy}
                  </span>
                )}
                {t.referralCode && t.status === "paid" && (
                  <InviteCode code={t.referralCode} />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {(mineState.error || mineState.claimed) && (
        <p aria-live="polite" className="text-sm">
          {mineState.error ? (
            <span className="text-meeple">{mineState.error}</span>
          ) : (
            <span className="text-ink/70">
              {mineState.claimed} is now yours.
            </span>
          )}
        </p>
      )}
      {(unclaimState.error || unclaimState.released) && (
        <p aria-live="polite" className="text-sm">
          {unclaimState.error ? (
            <span className="text-meeple">{unclaimState.error}</span>
          ) : (
            <span className="text-ink/70">
              Ticket unclaimed. It has a new code to pass on or claim.
            </span>
          )}
        </p>
      )}
      {!holdsOne && (
        <form action={action} className="flex flex-col gap-2">
          <label
            id="code-label"
            className="text-sm font-semibold text-navy"
            htmlFor="code"
          >
            Have a ticket code? Claim it here.
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <div
              role="group"
              aria-labelledby="code-label"
              className="w-full sm:w-auto"
            >
              <PinInput
                name="code"
                id="code"
                length={TICKET_CODE_LENGTH}
                dashAfter={3}
                alphanumeric
                normalize={normalizeTicketCode}
                autoFocus={false}
                disabled={pending}
              />
            </div>
            <Button type="submit" disabled={pending}>
              {pending ? "Claiming…" : "Claim"}
            </Button>
          </div>
          <p aria-live="polite" className="min-h-5 text-sm">
            {state.error ? (
              <span className="text-meeple">{state.error}</span>
            ) : state.claimed ? (
              <span className="text-ink/70">{state.claimed} is now yours.</span>
            ) : null}
          </p>
        </form>
      )}
    </section>
  );
}
