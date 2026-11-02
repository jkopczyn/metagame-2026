"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { StarIcon, XIcon } from "lucide-react";
import AccountAdder from "./AccountAdder";
import { addRsvpFor, removeRsvpFor, type FormState } from "./actions";
import PlanButtons from "@/v2/components/schedule/PlanButtons";
import type {
  Attendance,
  Attendee,
  PlanConflict,
  ScheduleSession,
  ViewerPlans,
} from "@/lib/schedule";

const NONE: Attendance[string] = { attendees: [], bookmarks: 0 };

/** RSVPs for one session. Changes apply at once, not on Save. */
export default function AttendancePanel({
  session,
  attendance = NONE,
  viewer,
  conflicts,
}: {
  session: ScheduleSession;
  attendance?: Attendance[string];
  viewer: (ViewerPlans & { userId: string }) | null;
  conflicts: PlanConflict[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (action: () => Promise<FormState>) =>
    start(async () => setError((await action()).error ?? null));

  const going = attendance.attendees.filter((a) => a.status === "going");
  const waiting = attendance.attendees.filter((a) => a.status === "waitlist");
  const cap = session.maxCapacity;

  const list = (title: string, people: Attendee[]) =>
    people.length > 0 && (
      <div>
        <p className="mb-1 text-xs font-medium tracking-wide text-ink/50 uppercase">
          {title}
        </p>
        <ul className="divide-y divide-line rounded-lg border border-line">
          {people.map((a) => (
            <li key={a.userId} className="flex items-center gap-2 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium text-ink">{a.name}</span>
                {a.name !== a.email && (
                  <span className="ml-2 text-xs text-ink/50">{a.email}</span>
                )}
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => removeRsvpFor(session.id, a.userId))}
                aria-label={`Remove ${a.name}`}
                title="Remove"
                className="rounded p-1 text-ink/40 hover:text-meeple"
              >
                <XIcon className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <section className="mt-6 space-y-3 border-t border-line pt-5 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-bebas text-xl tracking-wide text-navy">RSVPs</h3>
        <p className="text-ink/60">
          {going.length}
          {cap !== null && ` / ${cap}`} going
          {waiting.length > 0 && ` · ${waiting.length} waitlisted`}
          <span className="ml-2 inline-flex items-center gap-0.5">
            <StarIcon className="size-3.5" /> {attendance.bookmarks}
          </span>
        </p>
      </div>

      {viewer ? (
        <PlanButtons
          sessionId={session.id}
          status={viewer.rsvps[session.id] ?? null}
          bookmarked={viewer.bookmarks.includes(session.id)}
          full={cap !== null && going.length >= cap}
          commitment={session.rsvpIsCommitment}
          conflicts={conflicts}
          onSettled={() => router.refresh()}
        />
      ) : (
        <p className="text-xs text-ink/50">
          Sign in with an account to RSVP or bookmark as yourself.
        </p>
      )}

      {list("Going", going)}
      {list("Waitlist", waiting)}

      <AccountAdder
        label="Add RSVP"
        exclude={attendance.attendees.map((a) => a.userId)}
        onPick={(a) => run(() => addRsvpFor(session.id, a.userId))}
      />
      {error && <p className="text-xs text-meeple">{error}</p>}
    </section>
  );
}
