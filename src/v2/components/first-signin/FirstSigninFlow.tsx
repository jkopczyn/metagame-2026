"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { ExternalLink } from "lucide-react";
import { SOCIAL_LINKS } from "@/v2/lib/urls";
import { claim, claimMine, type ClaimState } from "@/app/(v2)/account/actions";
import {
  firstSigninHidden,
  type FirstSigninPrefill,
  type FirstSigninStatus,
  type TicketStep,
} from "@/lib/first-signin";
import {
  TICKET_CODE_LENGTH,
  normalizeTicketCode,
} from "@/lib/ticket-code-format";
import PinInput from "@/v2/components/auth/PinInput";
import { Button } from "@/v2/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/v2/components/ui/dialog";
import { Input } from "@/v2/components/ui/input";
import { CHILD_REGISTRATION_FORM_URL } from "@/v2/lib/links";
import { cn } from "@/v2/lib/utils";
import { HEADING, NEWSLETTER_LINK } from "../styles";
import { saveFirstSignin, type FirstSigninState } from "./actions";

const TICKETS_HREF = "/#tickets";
const FORM_ID = "first-signin";
const LABEL = "text-sm font-semibold text-cream";
const SECTION =
  "font-space-mono text-xs tracking-[0.12em] text-cream/60 uppercase";
const RECRUITERS_INFO =
  "Some of our sponsors are hiring! This opts you in to having your name and email address shared in a list they receive. Totally optional";

type Open = Extract<FirstSigninStatus, { needed: true }>;

// Asked from the client so the layout stays static. Re-asked on every
// navigation: signing up or in happens client-side and the layout never remounts.
export default function FirstSigninFlow() {
  const pathname = usePathname();
  const hidden = firstSigninHidden(pathname);
  const [status, setStatus] = useState<Open | null>(null);
  const [done, setDone] = useState(false);
  const [state, action, pending] = useActionState<FirstSigninState, FormData>(
    async (prev, formData) => {
      const result = await saveFirstSignin(prev, formData).catch(() => ({
        error: "We couldn't save that. Try again.",
      }));
      if ("saved" in result && result.saved) setDone(true);
      return result;
    },
    {},
  );

  useEffect(() => {
    if (hidden || status || done) return;
    let live = true;
    fetch("/api/first-signin")
      .then((res) => (res.ok ? res.json() : { needed: false }))
      .then((body: FirstSigninStatus) => {
        if (live && body.needed) setStatus(body);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [pathname, hidden, status, done]);

  if (!status || done || hidden) return null;
  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="flex max-h-[calc(100dvh-2rem)] max-w-[560px] flex-col gap-6 overflow-y-auto px-6 py-7 sm:px-9 sm:py-8"
      >
        <div>
          <DialogTitle className={`${HEADING} text-[28px] text-cream`}>
            One-time required info
          </DialogTitle>
          <DialogDescription className="mt-2 text-[15px] text-cream/80">
            We need a few basic pieces of info for your account.
          </DialogDescription>
        </div>
        <InfoForm prefill={status.prefill} action={action} state={state} />
        <div className="flex flex-col gap-3">
          <h3 className={`${HEADING} text-[22px] text-cream`}>
            {status.tickets.kind === "claimable" &&
            status.tickets.tickets.length > 1
              ? "Tickets"
              : "Ticket"}
          </h3>
          <TicketSection tickets={status.tickets} />
        </div>
        <Button
          type="submit"
          form={FORM_ID}
          disabled={pending}
          className="self-start"
        >
          {pending ? "Saving…" : "Save"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function InfoForm({
  prefill,
  action,
  state,
}: {
  prefill: FirstSigninPrefill;
  action: (formData: FormData) => void;
  state: FirstSigninState;
}) {
  const [bringingChildren, setBringingChildren] = useState<boolean | null>(
    null,
  );

  return (
    <form id={FORM_ID} action={action} className="flex flex-col gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <YesNo name="isAdult" label="Are you 18 or older?" />
        <div className="flex flex-col gap-2">
          <YesNo
            name="bringingChildren"
            label="Are you bringing any children under 13?"
            onChange={setBringingChildren}
          />
          {bringingChildren && (
            <a
              href={CHILD_REGISTRATION_FORM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                NEWSLETTER_LINK,
                "inline-flex items-center gap-1.5 text-sm",
              )}
            >
              Please register your children
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          )}
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="flex flex-col gap-0.5">
          <span className={LABEL}>
            Name
            <span aria-hidden className="ml-0.5 text-red-400">
              *
            </span>
          </span>
          <span className="text-sm text-cream/65">
            On RSVPs, hosting, badge, etc.
          </span>
        </span>
        <Input
          name="preferredName"
          defaultValue={prefill.preferredName}
          maxLength={80}
          required
        />
      </label>

      <label className={cn("flex items-start gap-2.5", LABEL)}>
        <input
          type="checkbox"
          name="shareWithRecruiters"
          defaultChecked={prefill.shareWithRecruiters}
          className="mt-0.5 size-4 shrink-0 accent-meeple"
        />
        <span className="flex flex-col gap-0.5">
          Share contact info with recruiters?
          <span className="text-sm font-normal text-cream/65">
            {RECRUITERS_INFO}
          </span>
        </span>
      </label>
      <span className={cn(SECTION, "mt-2")}>Optional</span>
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          <label htmlFor="first-signin-discord" className={LABEL}>
            Discord handle
          </label>
          <a
            href={SOCIAL_LINKS.DISCORD}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              NEWSLETTER_LINK,
              "inline-flex items-center gap-1.5 text-sm",
            )}
          >
            Join our Discord
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </div>
        <Input
          id="first-signin-discord"
          name="discordHandle"
          defaultValue={prefill.discordHandle}
          maxLength={40}
        />
      </div>
      <label className={cn("flex items-center gap-2.5", LABEL)}>
        <input
          type="checkbox"
          name="isPublic"
          // The column defaults to false, so "never chose" looks like "no";
          // the modal is the one place everyone chooses, and it starts on.
          defaultChecked
          className="size-4 accent-meeple"
        />
        Show profile publicly?
      </label>
      {state.error && (
        <p aria-live="polite" className="text-sm text-salmon">
          {state.error}
        </p>
      )}
    </form>
  );
}

function YesNo({
  name,
  label,
  onChange,
}: {
  name: string;
  label: string;
  onChange?: (value: boolean) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className={cn(LABEL, "mb-2")}>
        {label}
        <span aria-hidden className="ml-0.5 text-red-400">
          *
        </span>
        <span className="sr-only"> (required)</span>
      </legend>
      <div className="flex gap-2">
        {(["yes", "no"] as const).map((v) => (
          <label
            key={v}
            className="cursor-pointer rounded-lg border-[1.5px] border-cream/30 px-5 py-2 text-[15px] font-semibold text-cream transition-colors hover:border-cream has-checked:border-meeple has-checked:bg-meeple has-focus-visible:ring-2 has-focus-visible:ring-ring/60"
          >
            <input
              type="radio"
              name={name}
              value={v}
              required
              className="sr-only"
              onChange={() => onChange?.(v === "yes")}
            />
            {v === "yes" ? "Yes" : "No"}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function TicketSection({ tickets }: { tickets: TicketStep }) {
  const [claimed, setClaimed] = useState<string>();

  if (tickets.kind === "held" || claimed) {
    return (
      <p className="text-[15px] text-cream/80">
        {claimed ? `${claimed} is now yours.` : "You already have a ticket."}
      </p>
    );
  }

  return (
    <>
      <p className="text-[15px] text-cream/80">
        {tickets.kind === "claimable"
          ? foundCopy(tickets.tickets.length)
          : "Got a ticket code? Enter it to claim the ticket for your account."}
      </p>
      <p className="text-[15px] font-semibold text-cream">
        You will need a claimed ticket in order to attend.
      </p>
      {tickets.kind === "claimable" ? (
        <ClaimMine tickets={tickets.tickets} onClaimed={setClaimed} />
      ) : (
        <ClaimByCode onClaimed={setClaimed} />
      )}
      {tickets.kind === "code" && (
        <p className="text-sm text-cream/70">
          No ticket? Go{" "}
          <Link href={TICKETS_HREF} target="_blank" className={NEWSLETTER_LINK}>
            get one
          </Link>
          !
        </p>
      )}
    </>
  );
}

function foundCopy(n: number): string {
  return n === 1
    ? "We found a ticket purchased under your email. Click Claim to use it yourself, or share its code from your account page to transfer it."
    : `We found ${n} tickets purchased under your email. Click Claim to use one yourself, and share the others' codes from your account page to transfer them.`;
}

const purchased = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));

function ClaimMine({
  tickets,
  onClaimed,
}: {
  tickets: { id: string; tier: string; purchasedAt: string }[];
  onClaimed: (tier: string) => void;
}) {
  const [pending, start] = useTransition();
  // Which Claim was pressed, so only that button shows progress.
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [state, setState] = useState<ClaimState>({});
  return (
    <div className="flex flex-col gap-2">
      <ul className="divide-y divide-cream/15 rounded-lg border border-cream/15">
        {tickets.map((t) => (
          <li
            key={t.id}
            className="flex items-center justify-between gap-4 px-4 py-3"
          >
            <span className="flex flex-col">
              <span className="font-semibold text-cream">{t.tier}</span>
              <span className="text-xs text-cream/60">
                Purchased {purchased(t.purchasedAt)}
              </span>
            </span>
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() => {
                setClaimingId(t.id);
                start(async () => {
                  const result = await claimMine(t.id);
                  setState(result);
                  if (result.claimed) onClaimed(result.claimed);
                });
              }}
            >
              {pending && claimingId === t.id ? "Claiming…" : "Claim"}
            </Button>
          </li>
        ))}
      </ul>
      {state.error && (
        <p aria-live="polite" className="text-sm text-salmon">
          {state.error}
        </p>
      )}
    </div>
  );
}

function ClaimByCode({ onClaimed }: { onClaimed: (tier: string) => void }) {
  const [state, action, pending] = useActionState<ClaimState, FormData>(
    async (prev, formData) => {
      const result = await claim(prev, formData);
      if (result.claimed) onClaimed(result.claimed);
      return result;
    },
    {},
  );
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Ticket code" className="text-cream">
          <PinInput
            name="code"
            length={TICKET_CODE_LENGTH}
            dashAfter={3}
            alphanumeric
            normalize={normalizeTicketCode}
            autoFocus={false}
            disabled={pending}
          />
        </div>
        <Button type="submit" variant="ghost" disabled={pending}>
          {pending ? "Claiming…" : "Claim"}
        </Button>
      </div>
      {state.error && (
        <p aria-live="polite" className="text-sm text-salmon">
          {state.error}
        </p>
      )}
    </form>
  );
}
