import { cache } from "react";
import { teamAccess, type TeamAccess } from "@/lib/access";
import { currentSession, type Session } from "@/lib/auth";
import { ticketStep } from "@/lib/first-signin";
import {
  buildDays,
  hostsBoard,
  publicSchedule,
  viewerSessionIds,
  type Day,
  type PublicLocation,
  type PublicSession,
  type RsvpTicket,
  type ScheduleViewer,
} from "@/lib/schedule";
import {
  loadSchedule,
  loadViewerPlans,
  type Schedule,
} from "@/lib/schedule-store";
import { emailKey } from "@/lib/ticket-holder";
import {
  hasClaimedTicket,
  ticketLabel,
  ticketsForUser,
} from "@/lib/ticket-store";
import { boardNote, type BoardData } from "@/lib/unconference";
import { listNotesIn } from "@/lib/unconference-store";

export const loadRawSchedule = cache(loadSchedule);

/** Which rooms this access may see; whoever edits the schedule sees them all. */
const viewerOf = (access: TeamAccess | null): ScheduleViewer => {
  if (access?.permissions.has("schedule.manage")) return "team";
  if (access?.permissions.has("schedule.volunteer_rooms")) return "volunteer";
  return "public";
};

export const scheduleViewer = cache(async () => viewerOf(await teamAccess()));

export const loadPublicSchedule = cache(async () =>
  publicSchedule(await loadRawSchedule(), await scheduleViewer()),
);

/** The rooms that host the bulletin board, as much as this viewer may see. */
export const boardRooms = cache(async (): Promise<PublicLocation[]> => {
  const { locations } = await loadPublicSchedule();
  return locations.filter(hostsBoard);
});

/**
 * The unconference notes and what the viewer may do with them, or null when
 * no room this viewer can see is a board.
 *
 * Loaded here rather than in the board component because PublicSchedule is a
 * client component, and because this is the one place that already knows
 * which rooms survived the visibility filter — so notes pinned in a room the
 * viewer can't see are never read, let alone sent.
 */
export const loadBoard = cache(async (): Promise<BoardData | null> => {
  const rooms = await boardRooms();
  const [session, access] = await Promise.all([currentSession(), teamAccess()]);
  return boardFor(rooms, session, access);
});

/** The public sessions the signed-in viewer is in; null when signed out. */
export const loadMySessionIds = cache(async (): Promise<string[] | null> => {
  const account = await currentSession();
  if (!account) return null;
  const [raw, { sessions }] = await Promise.all([
    loadRawSchedule(),
    loadPublicSchedule(),
  ]);
  return mySessionIds(raw, sessions, account);
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

async function boardFor(
  rooms: PublicLocation[],
  session: Session | null,
  access: TeamAccess | null,
): Promise<BoardData | null> {
  if (rooms.length === 0) return null;
  const viewerId = session?.user.id ?? null;
  const notes = await listNotesIn(
    rooms.map((r) => r.id),
    viewerId,
  );
  return {
    // Mapped, not sent as read: the client needs the author's name and
    // whether the note is its own, never an account id. Posters stay
    // behind until a notice is opened.
    notes: notes.map((note) =>
      boardNote(note, viewerId, { withPoster: false }),
    ),
    signedIn: !!session,
    canPost:
      !!access?.permissions.has("unconference.post") && !session?.user.banned,
    isTeam: !!access?.permissions.has("schedule.manage"),
  };
}

async function mySessionIds(
  raw: Schedule,
  sessions: PublicSession[],
  session: Session | null,
): Promise<string[] | null> {
  if (!session) return null;
  const plans = await loadViewerPlans(session.user.id);
  const shown = new Set(sessions.map((s) => s.id));
  return viewerSessionIds(
    session.user.id,
    raw.sessions.filter((s) => shown.has(s.id)),
    plans,
  );
}

/** Everything /schedule shows this viewer, on first render and on a re-read. */
export type ScheduleSnapshot = {
  days: Day<PublicSession>[];
  locations: PublicLocation[];
  mine: string[] | null;
  board: BoardData | null;
  /** The server's clock at this read; going back can restore an old one. */
  readAt: number;
};

/** The first render, through the page's own loaders: a render has cache(). */
export async function loadPageSnapshot(): Promise<ScheduleSnapshot> {
  const [{ locations, sessions }, board, mine] = await Promise.all([
    loadPublicSchedule(),
    loadBoard(),
    loadMySessionIds(),
  ]);
  return {
    days: buildDays(sessions),
    locations,
    mine,
    board,
    readAt: Date.now(),
  };
}

// Reads each input once and hands it down: a route handler isn't a render, so
// React's cache() doesn't hold there, and each loader would check access again.
export async function loadScheduleSnapshot(): Promise<ScheduleSnapshot> {
  const [raw, access, session] = await Promise.all([
    loadRawSchedule(),
    teamAccess(),
    currentSession(),
  ]);
  const { locations, sessions } = publicSchedule(raw, viewerOf(access));
  const [board, mine] = await Promise.all([
    boardFor(locations.filter(hostsBoard), session, access),
    mySessionIds(raw, sessions, session),
  ]);
  return {
    days: buildDays(sessions),
    locations,
    mine,
    board,
    readAt: Date.now(),
  };
}
