"use client";

import { useState, type ReactNode } from "react";
import type {
  PlanConflict,
  RsvpStatus,
  RsvpTicket,
  SessionRsvps,
} from "@/lib/schedule";
import PlanButtons from "./PlanButtons";

/** A session page's RSVP controls and attendee list, updated together in place. */
export default function SessionPlans({
  sessionId,
  capacity,
  commitment,
  conflicts,
  rsvps: initial,
  ticket,
  plan,
  signIn,
}: {
  sessionId: string;
  capacity: number | null;
  commitment: boolean;
  conflicts: PlanConflict[];
  rsvps: SessionRsvps;
  ticket?: RsvpTicket;
  /** The viewer's own plan, or null when signed out. */
  plan: { status: RsvpStatus | null; bookmarked: boolean } | null;
  signIn: ReactNode;
}) {
  const [rsvps, setRsvps] = useState(initial);
  const [prev, setPrev] = useState(initial);
  if (prev !== initial) {
    setPrev(initial);
    setRsvps(initial);
  }

  return (
    <>
      {plan ? (
        <PlanButtons
          sessionId={sessionId}
          status={plan.status}
          bookmarked={plan.bookmarked}
          full={capacity !== null && rsvps.going >= capacity}
          commitment={commitment}
          conflicts={conflicts}
          ticket={ticket}
          onSettled={(result) => result.rsvps && setRsvps(result.rsvps)}
        />
      ) : (
        signIn
      )}
      <Attendees rsvps={rsvps} />
    </>
  );
}

function Attendees({ rsvps }: { rsvps: SessionRsvps }) {
  const counts = [
    `${rsvps.going} going`,
    rsvps.waitlist > 0 ? `${rsvps.waitlist} waitlisted` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  if (!rsvps.names) return <p className="text-[15px]">{counts}</p>;
  const list = (title: string, names: string[]) =>
    names.length > 0 && (
      <div>
        <p className="mb-1 text-xs tracking-[0.12em] text-[#1b1530]/55 uppercase">
          {title}
        </p>
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[15px]">
          {names.map((name, i) => (
            <li key={i}>{name}</li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[15px]">{counts}</p>
      {list("Going", rsvps.names.going)}
      {list("Waitlist", rsvps.names.waitlist)}
    </div>
  );
}
