import {
  formatPacificDay,
  formatPacificTime,
  isPlaced,
  planConflicts,
  type PlanConflict,
  type RsvpStatus,
  type ScheduleLocation,
  type ScheduleSession,
  type Status,
  type ViewerPlans,
} from "./schedule";

export type AccountSessionRow = {
  id: string;
  slug: string;
  /** Has a public /schedule page: published and placed. */
  listed: boolean;
  title: string;
  status: Status;
  /** "Sat, Nov 7 · 10:00 AM – 10:55 AM", or null while unscheduled. */
  when: string | null;
  room: string | null;
  /** Lead host, for the running list. */
  lead: boolean;
  rsvp: RsvpStatus | null;
  bookmarked: boolean;
  full: boolean;
  commitment: boolean;
  conflicts: PlanConflict[];
};

export type AccountSessions = {
  running: AccountSessionRow[];
  plans: AccountSessionRow[];
  bookmarks: AccountSessionRow[];
};

export function sessionWhen(
  s: Pick<ScheduleSession, "startsAt" | "endsAt">,
): string | null {
  if (!s.startsAt) return null;
  const start = `${formatPacificDay(s.startsAt)} · ${formatPacificTime(s.startsAt)}`;
  return s.endsAt ? `${start} – ${formatPacificTime(s.endsAt)}` : start;
}

/** Scheduled first in time order, then unscheduled by title. */
function byTime(a: ScheduleSession, b: ScheduleSession): number {
  if (a.startsAt && b.startsAt && a.startsAt !== b.startsAt)
    return a.startsAt.localeCompare(b.startsAt);
  if (a.startsAt && !b.startsAt) return -1;
  if (!a.startsAt && b.startsAt) return 1;
  return a.title.localeCompare(b.title);
}

/**
 * The account page's session lists. Only published sessions count, since
 * drafts include proposals the committee hasn't accepted; an admin viewer
 * also sees the drafts they host.
 */
export function accountSessions(
  userId: string,
  sessions: ScheduleSession[],
  locations: Pick<ScheduleLocation, "id" | "name">[],
  plans: ViewerPlans,
  goingCounts: Record<string, { going: number }>,
  viewerIsAdmin: boolean,
): AccountSessions {
  const rooms = new Map(locations.map((l) => [l.id, l.name]));
  const marked = new Set(plans.bookmarks);
  const row = (s: ScheduleSession): AccountSessionRow => ({
    id: s.id,
    slug: s.slug,
    listed: s.status === "published" && isPlaced(s),
    title: s.title,
    status: s.status,
    when: sessionWhen(s),
    room: s.locationId ? (rooms.get(s.locationId) ?? null) : null,
    lead: s.hosts[0]?.userId === userId,
    rsvp: plans.rsvps[s.id] ?? null,
    bookmarked: marked.has(s.id),
    full:
      s.maxCapacity !== null &&
      (goingCounts[s.id]?.going ?? 0) >= s.maxCapacity,
    commitment: s.rsvpIsCommitment,
    conflicts: planConflicts(s, sessions, userId, plans.rsvps),
  });
  const sorted = [...sessions].sort(byTime);
  const published = sorted.filter((s) => s.status === "published");
  return {
    running: (viewerIsAdmin ? sorted : published)
      .filter((s) => s.hosts.some((h) => h.userId === userId))
      .map(row),
    plans: published.filter((s) => plans.rsvps[s.id]).map(row),
    bookmarks: published
      .filter((s) => marked.has(s.id) && !plans.rsvps[s.id])
      .map(row),
  };
}
