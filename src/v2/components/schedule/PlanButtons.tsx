"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StarIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { claimMine } from "@/app/(v2)/account/actions";
import {
  bookmark,
  rsvpTo,
  unRsvp,
  type PlanResult,
} from "@/app/(v2)/schedule/actions";
import { Button } from "@/v2/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/v2/components/ui/dialog";
import {
  rsvpPrompt,
  type PlanConflict,
  type RsvpConfirm,
  type RsvpStatus,
  type RsvpTicket,
} from "@/lib/schedule";

type Plan = { status: RsvpStatus | null; bookmarked: boolean };
type Field = keyof Plan;

const TONE: Record<
  RsvpConfirm["tone"],
  { content: string; title: string; list: string }
> = {
  confirm: { content: "border-line", title: "text-navy", list: "" },
  warning: {
    content: "border-2 border-tan",
    title: "text-navy",
    list: "border-tan bg-peach/40",
  },
  urgent: {
    content: "border-2 border-meeple",
    title: "text-meeple",
    list: "border-meeple bg-meeple/10",
  },
};

// Above RouteModal (z-[100]), which hosts these on the session page.
const DIALOG_OVERLAY = "z-[110]";
const DIALOG = "z-[110] max-w-[440px] bg-white px-6 py-5 text-ink";
const DIALOG_TITLE =
  "mb-2 flex items-center gap-2 font-grotesk text-xl font-bold";
// On DialogDescription itself, so cn() overrides its cream default; on an
// asChild child they'd only be concatenated with it.
const DIALOG_BODY = "flex flex-col gap-3 text-sm text-ink/80";
const CANCEL =
  "rounded-md px-3 py-2 text-sm font-semibold text-ink/70 hover:text-navy";

/**
 * The signed-in attendee's RSVP and bookmark controls for one session.
 * Clicks show at once; the server's answer then settles them.
 */
export default function PlanButtons({
  sessionId,
  status,
  bookmarked,
  full,
  commitment = false,
  conflicts = [],
  ticket,
  onSettled,
}: {
  sessionId: string;
  status: RsvpStatus | null;
  bookmarked: boolean;
  /** Going count has reached capacity, so a new RSVP joins the waitlist. */
  full: boolean;
  /** RSVPing claims a spot people rely on, so it's confirmed first. */
  commitment?: boolean;
  /** The viewer's other sessions at the same time, warned about first. */
  conflicts?: PlanConflict[];
  /** Without it the server's answer is the only ticket check. */
  ticket?: RsvpTicket;
  onSettled?: (result: PlanResult) => void;
}) {
  const fromProps: Plan = { status, bookmarked };
  // `confirmed` is the server's last answer, for rolling back a failed click.
  const [state, setState] = useState({
    shown: fromProps,
    confirmed: fromProps,
    props: fromProps,
  });
  const plan = state.shown;
  const latest = useRef<Record<Field, number>>({ status: 0, bookmarked: 0 });
  const rsvpSaving = useRef(false);
  // Index into prompt.confirms of the dialog showing, or null when closed.
  const [step, setStep] = useState<number | null>(null);
  const prompt = rsvpPrompt(commitment, full, conflicts);
  const confirm = step === null ? null : (prompt.confirms[step] ?? null);
  const tone = confirm && TONE[confirm.tone];
  const join = () => runRsvp(full ? "waitlist" : "going");
  const [claimed, setClaimed] = useState(false);
  // The ticket dialog's activatable tickets while it's open, else null.
  const [askTicket, setAskTicket] = useState<RsvpTicket["claimable"] | null>(
    null,
  );
  const hasTicket = claimed || (ticket?.has ?? true);
  const proceed = () => (prompt.confirms.length > 0 ? setStep(0) : join());

  // A server render with new values (e.g. after navigating back) wins.
  if (state.props.status !== status || state.props.bookmarked !== bookmarked) {
    setState({ shown: fromProps, confirmed: fromProps, props: fromProps });
  }

  // Server actions run one at a time in click order, so the last click's
  // answer is the final state; earlier answers only update `confirmed`.
  async function run<F extends Field>(
    field: F,
    next: Plan[F],
    action: () => Promise<PlanResult>,
    done: string,
  ) {
    const seq = ++latest.current[field];
    const toastId = `plan-${sessionId}-${field}`;
    setState((s) => ({ ...s, shown: { ...s.shown, [field]: next } }));
    let result: PlanResult;
    try {
      result = await action();
    } catch {
      result = { error: "Couldn’t save. Try again." };
    }
    const isLatest = seq === latest.current[field];
    if (result.error) {
      if (isLatest) {
        setState((s) => ({
          ...s,
          shown: { ...s.shown, [field]: s.confirmed[field] },
        }));
        if (result.needsTicket) setAskTicket(result.needsTicket);
        else toast.error(result.error, { id: toastId });
      }
      return;
    }
    const value = field === "status" ? result.status : result.bookmarked;
    if (value !== undefined) {
      setState((s) => ({
        ...s,
        confirmed: { ...s.confirmed, [field]: value },
        shown: isLatest ? { ...s.shown, [field]: value } : s.shown,
      }));
    }
    if (isLatest) {
      toast.success(
        field === "status" && result.status === "waitlist"
          ? "It’s full, so you’re on the waitlist."
          : done,
        { id: toastId },
      );
      onSettled?.(result);
    }
  }

  // RSVP and Cancel swap places, so a double-click would undo itself.
  async function runRsvp(next: RsvpStatus | null) {
    if (rsvpSaving.current) return;
    rsvpSaving.current = true;
    try {
      await run(
        "status",
        next,
        () => (next ? rsvpTo(sessionId) : unRsvp(sessionId)),
        next
          ? "You’re going."
          : plan.status === "waitlist"
            ? "You’ve left the waitlist."
            : "RSVP cancelled.",
      );
    } finally {
      rsvpSaving.current = false;
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {plan.status === null ? (
        <Button
          size="sm"
          onClick={() =>
            hasTicket ? proceed() : setAskTicket(ticket?.claimable ?? [])
          }
        >
          {prompt.label}
        </Button>
      ) : (
        <>
          <span className="text-sm font-medium text-navy">
            {plan.status === "going"
              ? "You’re going"
              : "You’re on the waitlist"}
          </span>
          <Button size="sm" variant="navy" onClick={() => runRsvp(null)}>
            {plan.status === "going" ? "Cancel RSVP" : "Leave waitlist"}
          </Button>
        </>
      )}
      <button
        type="button"
        onClick={() =>
          run(
            "bookmarked",
            !plan.bookmarked,
            () => bookmark(sessionId, !plan.bookmarked),
            plan.bookmarked ? "Bookmark removed." : "Bookmarked.",
          )
        }
        aria-pressed={plan.bookmarked}
        title={plan.bookmarked ? "Remove bookmark" : "Bookmark"}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-ink/70 hover:text-navy"
      >
        <StarIcon
          className={`size-4 ${plan.bookmarked ? "fill-amber-400 text-amber-500" : ""}`}
        />
        {plan.bookmarked ? "Bookmarked" : "Bookmark"}
      </button>
      {confirm && tone && (
        <Dialog
          // A fresh dialog per step, so the next one opens rather than morphs.
          key={step}
          open
          onOpenChange={(open) => !open && setStep(null)}
        >
          <DialogContent
            role="alertdialog"
            showCloseButton={false}
            overlayClassName={DIALOG_OVERLAY}
            className={`${DIALOG} ${tone.content}`}
          >
            <DialogTitle className={`${DIALOG_TITLE} ${tone.title}`}>
              {confirm.conflicts.length > 0 && (
                <TriangleAlertIcon aria-hidden className="size-5 shrink-0" />
              )}
              {confirm.title}
            </DialogTitle>

            <DialogDescription asChild className={DIALOG_BODY}>
              <div>
                {confirm.conflicts.length > 0 && (
                  <ul
                    className={`flex flex-col gap-1 rounded-md border-l-4 px-3 py-2 font-semibold text-ink ${tone.list}`}
                  >
                    {confirm.conflicts.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                )}
                {confirm.body && <p>{confirm.body}</p>}
              </div>
            </DialogDescription>
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setStep(null)}
                className={CANCEL}
              >
                Cancel
              </button>
              <Button
                size="sm"
                onClick={() => {
                  const next = step! + 1;
                  if (next < prompt.confirms.length) {
                    setStep(next);
                  } else {
                    setStep(null);
                    join();
                  }
                }}
              >
                Continue
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {askTicket !== null && (
        <TicketDialog
          claimable={askTicket}
          onClose={() => setAskTicket(null)}
          onClaimed={() => {
            setClaimed(true);
            setAskTicket(null);
            proceed();
          }}
        />
      )}
    </div>
  );
}

/** Shown instead of RSVPing without a ticket; offers one bought on the account. */
function TicketDialog({
  claimable,
  onClose,
  onClaimed,
}: {
  claimable: RsvpTicket["claimable"];
  onClose: () => void;
  onClaimed: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const mine = claimable[0];
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        role="alertdialog"
        showCloseButton={false}
        overlayClassName={DIALOG_OVERLAY}
        className={`${DIALOG} border-line`}
      >
        <DialogTitle className={`${DIALOG_TITLE} text-navy`}>
          You need a ticket to RSVP
        </DialogTitle>
        <DialogDescription asChild className={DIALOG_BODY}>
          <div>
            <p>RSVPs to sessions are for ticket holders.</p>
            {mine && (
              <p>
                A {mine.tier} ticket was bought on your account. Activate it for
                yourself? Or{" "}
                <Link
                  href="/#tickets"
                  className="font-semibold text-navy underline underline-offset-2 hover:text-meeple"
                >
                  get another ticket
                </Link>
                .
              </p>
            )}
            {!mine && (
              <p>
                Have a ticket code?{" "}
                <Link
                  href="/account?tab=tickets"
                  className="font-semibold text-navy underline underline-offset-2 hover:text-meeple"
                >
                  Enter it on your account
                </Link>
                .
              </p>
            )}
            {error && <p className="font-semibold text-meeple">{error}</p>}
          </div>
        </DialogDescription>
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={onClose} className={CANCEL}>
            Cancel
          </button>
          {mine ? (
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await claimMine(mine.id).catch(() => ({
                    error: "Couldn’t activate it. Try again.",
                  }));
                  if (result.error) {
                    setError(result.error);
                    return;
                  }
                  // Ticket holders see who's coming, so re-read the page.
                  router.refresh();
                  onClaimed();
                })
              }
            >
              {pending ? "Activating…" : "Activate my ticket"}
            </Button>
          ) : (
            <Button size="sm" asChild>
              <Link href="/#tickets">Get a ticket</Link>
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
