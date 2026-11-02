// What a profile page may show about one person, for two audiences: the
// public /u/<id> and the team's /backstage/users/<id>. Plain data, no
// database imports, so the client components can use the types.

import {
  isPlaced,
  publicAccountName,
  roomVisible,
  type Ages,
  type Category,
  type PublicLocation,
  type RsvpStatus,
  type ScheduleLocation,
  type ScheduleViewer,
  type ScheduleSession,
  type Status,
  type ViewerPlans,
} from "./schedule";

/**
 * Which of the person's own profile fields a stranger may read. Everything
 * else on `profiles` and `user` — email, Discord handle, isAdult,
 * bringingChildren, shareWithRecruiters, role, ban state — stays off this
 * type so it can't leak by spreading a row.
 */
export type PublicProfile = {
  userId: string;
  name: string;
  pronouns: string | null;
  bio: string | null;
  /** Normalized to an http(s) URL, or dropped. */
  website: string | null;
  imageUrl: string | null;
};

export type ProfileRow = {
  user: { id: string; name: string | null; banned?: boolean | null };
  profile: {
    pronouns: string | null;
    bio: string | null;
    website: string | null;
    imageUrl: string | null;
    isPublic: boolean;
  } | null;
};

const clean = (value: string | null | undefined): string | null =>
  value?.trim() ? value.trim() : null;

/** Matches the schedule's publicName: never the email, which isn't public. */
export function publicName(name: string | null | undefined): string {
  return clean(name) ?? "Someone";
}

/**
 * A link the person typed, as an http(s) URL. A bare "alex.example" gets
 * https://; anything with another scheme (javascript:, data:) is dropped.
 */
export function safeWebsite(raw: string | null | undefined): string | null {
  const value = clean(raw);
  if (!value) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value)
    ? value
    : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** "alex.example/games" — the URL without its scheme or trailing slash. */
export function websiteLabel(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export type ProfileViewer = {
  /** There is a signed-in account; /u is closed to the logged out. */
  signedIn: boolean;
  /** The viewer is this profile's owner. Implies signedIn. */
  self: boolean;
  /** Holds profiles.view — team, admins and volunteers. */
  canViewAll: boolean;
};

/**
 * Which page this viewer gets. "none" is a 404 rather than a 403, so the
 * route never confirms that an account exists.
 */
export type ProfileAccess =
  | "none"
  /** The profile as anyone signed in sees it. */
  | "shown"
  /** The owner's look at their own page before they've shown it to anyone. */
  | "own-preview"
  /** A profiles.view holder reading a profile its owner hasn't shown. */
  | "team-private";

/**
 * `isPublic` means "other attendees may see this", which is what the account
 * checkbox has always said — so it gates other attendees, not the team, and
 * never reaches the logged out. A banned account has no page at all; the team
 * reads those on /backstage/users instead.
 */
export function profileAccess(
  row: ProfileRow,
  viewer: ProfileViewer,
): ProfileAccess {
  if (!viewer.signedIn || row.user.banned) return "none";
  if (row.profile?.isPublic) return "shown";
  if (viewer.self) return "own-preview";
  if (viewer.canViewAll) return "team-private";
  return "none";
}

/**
 * The person's own words, projected onto the six fields a profile page may
 * show. This is a projection, not a gate — callers run profileAccess() first.
 */
export function publicProfileFields(row: ProfileRow): PublicProfile {
  return {
    userId: row.user.id,
    name: publicName(row.user.name),
    pronouns: clean(row.profile?.pronouns),
    bio: clean(row.profile?.bio),
    website: safeWebsite(row.profile?.website),
    // The column has an https-only check constraint; this keeps a stray row honest.
    imageUrl: row.profile?.imageUrl?.startsWith("https://")
      ? row.profile.imageUrl
      : null,
  };
}

export const SESSION_ROLES = ["hosting", "shepherding", "attending"] as const;
export type UserSessionRole = (typeof SESSION_ROLES)[number];

export const ROLE_LABELS: Record<UserSessionRole, string> = {
  hosting: "Hosting",
  shepherding: "Shepherding",
  attending: "Attending",
};

export type UserSession = {
  id: string;
  slug: string;
  title: string;
  category: Category | null;
  ages: Ages | null;
  sponsored: boolean;
  /** Null only for an unplaced draft, which the public view never sees. */
  startsAt: string | null;
  endsAt: string | null;
  locationId: string | null;
  hosts: { name: string }[];
  status: Status;
  /** Why this session is on their profile; a session can be in more than one. */
  roles: UserSessionRole[];
  /** Lead host rather than a co-host. */
  lead: boolean;
  rsvp: RsvpStatus | null;
};

export type UserSessionsView = {
  sessions: UserSession[];
  /** Only the rooms these sessions use, so the grid stays narrow. */
  locations: PublicLocation[];
};

/**
 * What a profile page's session lists may contain. The public page turns all
 * three off; flip one here and both the lists and the grid follow.
 */
export type SessionAudience = {
  /** Drafts and unplaced sessions — proposals the committee hasn't accepted. */
  drafts: boolean;
  /** Who the committee assigned to shepherd a session. */
  shepherding: boolean;
  /** The person's RSVPs, which say where they'll be. */
  attending: boolean;
};

export const PUBLIC_AUDIENCE: SessionAudience = {
  drafts: false,
  shepherding: false,
  attending: false,
};

export const TEAM_AUDIENCE: SessionAudience = {
  drafts: true,
  shepherding: true,
  attending: true,
};

/** Scheduled first in time order, then unscheduled by title. */
function byTime(a: UserSession, b: UserSession): number {
  if (a.startsAt && b.startsAt && a.startsAt !== b.startsAt)
    return a.startsAt.localeCompare(b.startsAt);
  if (a.startsAt && !b.startsAt) return -1;
  if (!a.startsAt && b.startsAt) return 1;
  return a.title.localeCompare(b.title);
}

/**
 * One person's sessions and the rooms they use. `plans` is the RSVPs of the
 * person being looked at, and may be null when the audience can't see them.
 */
export function userSessions(
  userId: string,
  schedule: {
    locations: ScheduleLocation[];
    sessions: ScheduleSession[];
  },
  plans: ViewerPlans | null,
  audience: SessionAudience,
  /** Defaults to the least a viewer can see, so a forgotten argument fails safe. */
  viewer: ScheduleViewer = "public",
): UserSessionsView {
  const rsvps = audience.attending ? (plans?.rsvps ?? {}) : {};
  // Room visibility is the schedule's rule, not the audience's: a session in
  // a room this viewer can't see is as hidden here as it is on /schedule.
  const rooms = new Set(
    schedule.locations.filter((l) => roomVisible(l, viewer)).map((l) => l.id),
  );
  const sessions: UserSession[] = [];
  for (const s of schedule.sessions) {
    if (!audience.drafts && !(s.status === "published" && isPlaced(s)))
      continue;
    if (s.locationId !== null && !rooms.has(s.locationId)) continue;
    const hostIndex = s.hosts.findIndex((h) => h.userId === userId);
    const roles: UserSessionRole[] = [];
    if (hostIndex >= 0) roles.push("hosting");
    if (audience.shepherding && s.shepherd?.userId === userId)
      roles.push("shepherding");
    if (rsvps[s.id]) roles.push("attending");
    if (roles.length === 0) continue;
    sessions.push({
      id: s.id,
      slug: s.slug,
      title: s.title,
      category: s.category,
      ages: s.ages,
      sponsored: s.sponsored,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      locationId: s.locationId,
      hosts: s.hosts.map((h) => ({ name: publicAccountName(h) })),
      status: s.status,
      roles,
      lead: hostIndex === 0,
      rsvp: rsvps[s.id] ?? null,
    });
  }
  sessions.sort(byTime);
  const used = new Set(sessions.map((s) => s.locationId));
  const locations = schedule.locations
    .filter((l) => used.has(l.id))
    .map((l) => ({
      id: l.id,
      name: l.name,
      capacity: l.capacity,
      campusLocation: l.campusLocation,
      thumbnailUrl: l.thumbnailUrl,
      imageUrl: l.imageUrl,
    }));
  return { sessions, locations };
}

export const withRole = (
  sessions: UserSession[],
  role: UserSessionRole,
): UserSession[] => sessions.filter((s) => s.roles.includes(role));
