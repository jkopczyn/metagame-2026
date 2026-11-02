"use server";

import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { currentSession } from "@/lib/auth";
import type { RsvpStatus, RsvpTicket, SessionRsvps } from "@/lib/schedule";
import {
  cancelRsvp,
  loadSessionRsvps,
  rsvp,
  setBookmark,
} from "@/lib/schedule-store";
import { rsvpTicket } from "./data";

// No revalidatePath: it would re-render the whole current route behind every
// click. The caller updates in place from this result.
export type PlanResult = {
  error?: string;
  status?: RsvpStatus | null;
  bookmarked?: boolean;
  rsvps?: SessionRsvps;
  /** Refused for want of a claimed ticket: any the viewer could activate. */
  needsTicket?: RsvpTicket["claimable"];
};

/** The signed-in user, if they may act on this session. */
async function attendee(sessionId: string): Promise<string | PlanResult> {
  const session = await currentSession();
  const u = session?.user;
  if (!u) return { error: "Sign in first." };
  if (u.banned) return { error: "This account can't RSVP." };
  // Organizers can try drafts out; everyone else sees published sessions only.
  if (u.role !== "admin") {
    const [row] = await getDb()
      .select({ status: schema.sessions.status })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);
    if (row?.status !== "published") return { error: "No such session." };
  }
  return u.id;
}

async function act(
  sessionId: string,
  run: (userId: string) => Promise<PlanResult>,
): Promise<PlanResult> {
  const who = await attendee(sessionId);
  if (typeof who !== "string") return who;
  try {
    return await run(who);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Going, or waitlisted when the session is full. */
export async function rsvpTo(sessionId: string): Promise<PlanResult> {
  return act(sessionId, async (userId) => {
    const ticket = await rsvpTicket();
    if (ticket && !ticket.has) {
      return {
        error: "You need a ticket to RSVP.",
        needsTicket: ticket.claimable,
      };
    }
    const status = await rsvp(sessionId, userId);
    return { status, rsvps: await loadSessionRsvps(sessionId) };
  });
}

export async function unRsvp(sessionId: string): Promise<PlanResult> {
  return act(sessionId, async (userId) => {
    await cancelRsvp(sessionId, userId);
    return { status: null, rsvps: await loadSessionRsvps(sessionId) };
  });
}

export async function bookmark(
  sessionId: string,
  on: boolean,
): Promise<PlanResult> {
  return act(sessionId, async (userId) => {
    await setBookmark(sessionId, userId, on);
    return { bookmarked: on };
  });
}
