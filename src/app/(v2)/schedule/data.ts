import { cache } from "react";
import { connection } from "next/server";
import { can, teamAccess } from "@/lib/access";
import { toolAccess } from "@/lib/admin-auth";
import { currentSession } from "@/lib/auth";
import { ticketStep } from "@/lib/first-signin";
import {
  publicSchedule,
  viewerSessionIds,
  type RsvpTicket,
  type ScheduleViewer,
} from "@/lib/schedule";
import { loadSchedule, loadViewerPlans } from "@/lib/schedule-store";
import { emailKey } from "@/lib/ticket-holder";
import {
  hasClaimedTicket,
  ticketLabel,
  ticketsForUser,
} from "@/lib/ticket-store";

// Pre-launch gate: canSeeSchedule() for links, scheduleGate() for the page
// itself. Remove at launch.
export async function canSeeSchedule(): Promise<boolean> {
  return !!(await toolAccess("schedule.preview"));
}

/** Why a viewer isn't getting the schedule, so the page can say which. */
export type ScheduleGate = "ok" | "signed-out" | "closed";

/**
 * The gate as a verdict rather than a 404. "There is a schedule" is no
 * secret, so a viewer who can't see it yet is told why instead of being shown
 * a broken link.
 */
export const scheduleGate = cache(async (): Promise<ScheduleGate> => {
  await connection();
  if (await canSeeSchedule()) return "ok";
  return (await currentSession()) ? "closed" : "signed-out";
});

export const loadRawSchedule = cache(loadSchedule);

/** Which rooms this request may see; whoever edits the schedule sees them all. */
export const scheduleViewer = cache(async (): Promise<ScheduleViewer> => {
  if (await can("schedule.manage")) return "team";
  if (await can("schedule.volunteer_rooms")) return "volunteer";
  return "public";
});

export const loadPublicSchedule = cache(async () =>
  publicSchedule(await loadRawSchedule(), await scheduleViewer()),
);

/** The public sessions the signed-in viewer is in; null when signed out. */
export const loadMySessionIds = cache(async (): Promise<string[] | null> => {
  const account = await currentSession();
  if (!account) return null;
  const [raw, { sessions }, plans] = await Promise.all([
    loadRawSchedule(),
    loadPublicSchedule(),
    loadViewerPlans(account.user.id),
  ]);
  const shown = new Set(sessions.map((s) => s.id));
  return viewerSessionIds(
    account.user.id,
    raw.sessions.filter((s) => shown.has(s.id)),
    plans,
  );
});

/**
 * Whether the signed-in viewer may RSVP, and any ticket bought under their
 * email they could activate first; undefined when signed out. RSVPs need a
 * claimed ticket, but admins can try sessions out without one.
 */
export async function rsvpTicket(): Promise<RsvpTicket | undefined> {
  const account = await currentSession();
  if (!account) return undefined;
  const { id, email: raw } = account.user;
  if ((await hasClaimedTicket(id)) || (await teamAccess())?.admin) {
    return { has: true, claimable: [] };
  }
  const email = emailKey(raw);
  const rows = await ticketsForUser(id, email);
  const step = ticketStep(
    rows.map((t) => ({ ...t, tier: ticketLabel(t.tier) })),
    id,
    email,
  );
  return {
    has: false,
    claimable:
      step.kind === "claimable"
        ? step.tickets.map(({ id, tier }) => ({ id, tier }))
        : [],
  };
}
