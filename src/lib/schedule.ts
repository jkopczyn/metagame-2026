// Schedule types and time math shared by the server loaders and the client
// grid. Everything here is plain data: no database imports, so client
// components can use it. Times are stored UTC and shown in Pacific, the
// conference's zone.

export const CATEGORIES = ["talk", "workshop", "game", "other"] as const;
export const AGES = ["all", "kids", "adults"] as const;
export const STATUSES = ["draft", "published"] as const;
export const LOCATION_VISIBILITIES = ["public", "volunteer", "hidden"] as const;

export type Category = (typeof CATEGORIES)[number];
export type Ages = (typeof AGES)[number];
export type Status = (typeof STATUSES)[number];
export type LocationVisibility = (typeof LOCATION_VISIBILITIES)[number];

/** Who a room is for, as the backstage room list and form say it. */
export const VISIBILITY_LABEL: Record<LocationVisibility, string> = {
  public: "Everyone",
  volunteer: "Volunteers and team",
  hidden: "Team only",
};

export type ScheduleLocation = {
  id: string;
  name: string;
  capacity: number | null;
  campusLocation: string | null;
  description: string | null;
  displayOrder: number;
  visibility: LocationVisibility;
  /** Public Vercel Blob URL, already thumbnail-sized. */
  thumbnailUrl: string | null;
  /** Public Vercel Blob URL, about 1600px, for detail views. */
  imageUrl: string | null;
};

export type ScheduleSession = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  category: Category | null;
  /** ISO strings; both null while a draft is unplaced. */
  startsAt: string | null;
  endsAt: string | null;
  locationId: string | null;
  maxCapacity: number | null;
  minCapacity: number | null;
  ages: Ages | null;
  needs: string | null;
  status: Status;
  /** An RSVP claims a limited spot people rely on, not just interest. */
  rsvpIsCommitment: boolean;
  sponsored: boolean;
  /** The Airtable RFP Submissions row this came from. */
  airtableRfpRecordId: string | null;
  /** Billing order, lead first. */
  hosts: ScheduleAccount[];
  /** Committee member shepherding it; admin-only. */
  shepherd: ScheduleAccount | null;
};

export type ScheduleAccount = {
  userId: string;
  /** Account name, else email. */
  name: string;
  email: string;
};

/**
 * An account's name as other attendees see it. The loaders read it with
 * accountName(), which falls back to the email when the name is blank, so
 * that fallback has to be undone before the name leaves the team's tools.
 */
export function publicAccountName(account: {
  name: string;
  email: string;
}): string {
  const name = account.name.trim();
  return name && name !== account.email ? name : "Someone";
}

export const RSVP_STATUSES = ["going", "waitlist"] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];

export type Attendee = ScheduleAccount & { status: RsvpStatus };

/** Who's coming to each session, for organizers. Keyed by session id. */
export type Attendance = Record<
  string,
  { attendees: Attendee[]; bookmarks: number }
>;

/** The signed-in viewer's own RSVPs and bookmarks. */
export type ViewerPlans = {
  rsvps: Record<string, RsvpStatus>;
  bookmarks: string[];
};

/** One session's RSVPs as the public page may show them. */
export type SessionRsvps = {
  going: number;
  waitlist: number;
  /** Null unless the viewer may see who's coming. */
  names: { going: string[]; waitlist: string[] } | null;
};

/** Counts for everyone; names only when `showNames`. Rows earliest first. */
export function summarizeRsvps(
  rows: { status: RsvpStatus; name: string }[],
  showNames: boolean,
): SessionRsvps {
  const going = rows.filter((r) => r.status === "going").map((r) => r.name);
  const waitlist = rows
    .filter((r) => r.status === "waitlist")
    .map((r) => r.name);
  return {
    going: going.length,
    waitlist: waitlist.length,
    names: showNames ? { going, waitlist } : null,
  };
}

/** What ties the viewer to a session besides a bookmark. */
export type PlanRole = "host" | "shepherd" | RsvpStatus;

/** Another session the viewer is already tied to at the same time. */
export type PlanConflict = {
  role: PlanRole;
  title: string;
  startsAt: string;
  endsAt: string;
  commitment: boolean;
};

/**
 * The viewer's other published sessions that overlap `target`: ones they
 * host, shepherd or have RSVP'd to. Back-to-back sessions don't overlap.
 */
export function planConflicts(
  target: Pick<ScheduleSession, "id" | "startsAt" | "endsAt">,
  sessions: ScheduleSession[],
  viewerId: string,
  rsvps: Record<string, RsvpStatus>,
): PlanConflict[] {
  if (!isPlaced(target)) return [];
  const start = Date.parse(target.startsAt);
  const end = Date.parse(target.endsAt);
  const role = (s: ScheduleSession): PlanRole | null => {
    if (s.hosts.some((h) => h.userId === viewerId)) return "host";
    if (s.shepherd?.userId === viewerId) return "shepherd";
    return rsvps[s.id] ?? null;
  };
  return sessions
    .filter(isPlaced)
    .filter(
      (s) =>
        s.id !== target.id &&
        s.status === "published" &&
        Date.parse(s.startsAt) < end &&
        Date.parse(s.endsAt) > start,
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .flatMap((s) => {
      const r = role(s);
      return r
        ? [
            {
              role: r,
              title: s.title,
              startsAt: s.startsAt,
              endsAt: s.endsAt,
              commitment: s.rsvpIsCommitment,
            },
          ]
        : [];
    });
}

const ROLE_PHRASE: Record<PlanRole, string> = {
  host: "You’re hosting",
  shepherd: "You’re shepherding",
  going: "You’ve already RSVP’d to",
  waitlist: "You’re on the waitlist for",
};

/** "You’re hosting “Chess” 2:00 PM–3:00 PM" */
export function conflictLine(c: PlanConflict): string {
  return `${ROLE_PHRASE[c.role]} “${c.title}” ${formatPacificTime(c.startsAt)}–${formatPacificTime(c.endsAt)} PT`;
}

export type RsvpConfirm = {
  title: string;
  /** What already has the viewer at that time, one line each. */
  conflicts: string[];
  body: string;
  /** "urgent" when a clash involves a commitment session, either side. */
  tone: "confirm" | "warning" | "urgent";
};

const COMMITMENT_TITLE = "RSVPing here is a commitment";
const COMMITMENT_STAKES =
  "RSVPs here are a firmer commitment than attending a talk — there are a limited number of spots and they’ll be counting on you to attend.";

const BUSY_TITLE: Record<PlanRole, string> = {
  host: "You’re hosting something at this time",
  shepherd: "You’re shepherding something at this time",
  going: "You’ve already RSVP’d to something at this time",
  waitlist: "You’re on a waitlist for something at this time",
};
const ROLE_ORDER: PlanRole[] = ["host", "shepherd", "going", "waitlist"];

/**
 * How the RSVP button reads, and the dialogs to confirm in turn before it goes
 * through: none for an interest-only session with no clash, which RSVPs in
 * one click.
 */
export function rsvpPrompt(
  commitment: boolean,
  full: boolean,
  conflicts: PlanConflict[] = [],
): { label: string; confirms: RsvpConfirm[] } {
  const label = full ? "Join waitlist" : commitment ? "Claim a spot" : "RSVP";
  const commitmentStep: RsvpConfirm = {
    title: COMMITMENT_TITLE,
    conflicts: [],
    body: COMMITMENT_STAKES,
    tone: "confirm",
  };
  if (conflicts.length === 0) {
    return { label, confirms: commitment ? [commitmentStep] : [] };
  }
  const running = conflicts.some(
    (c) => c.role === "host" || c.role === "shepherd",
  );
  // A waitlist place holds no spot, so only "going" is counted on.
  const held = conflicts.filter(
    (c) => c.commitment && c.role === "going",
  ).length;
  const yours = held > 1 ? "your existing RSVPs" : "your existing RSVP";
  const stakesNote =
    commitment && !running && held > 0
      ? `The session you’re joining and ${yours} both have limited spots and will be counting on you to attend. If you switch, cancel ${yours} so someone else can take your place.`
      : commitment && !running
        ? "The session you’re joining has limited spots and will be counting on you to attend — a firmer commitment than attending a talk."
        : held > 0
          ? `${held > 1 ? "Your existing RSVPs are for sessions" : "Your existing RSVP is for a session"} with limited spots that will be counting on you. If you switch, cancel ${held > 1 ? "them" : "it"} so someone else can take your place.`
          : null;
  const top = ROLE_ORDER.find((r) => conflicts.some((c) => c.role === r))!;
  const clash: RsvpConfirm = {
    title: BUSY_TITLE[top],
    conflicts: conflicts.map(conflictLine),
    body: [
      conflicts.some((c) => c.role === "shepherd")
        ? "Make sure you can fulfill your shepherd duties."
        : null,
      stakesNote,
    ]
      .filter(Boolean)
      .join(" "),
    tone:
      commitment || conflicts.some((c) => c.commitment) ? "urgent" : "warning",
  };
  // The clash dialog only carries the joined session's stakes when the viewer
  // isn't running something then, so otherwise they get their own step.
  return {
    label,
    confirms: commitment && running ? [clash, commitmentStep] : [clash],
  };
}

/** Whether the viewer may RSVP yet, and any ticket bought on their account they could claim to. */
export type RsvpTicket = {
  has: boolean;
  claimable: { id: string; tier: string }[];
};

export function hostNames(session: { hosts: { name: string }[] }): string {
  return session.hosts.map((h) => h.name).join(", ");
}

export const CONFERENCE_DAYS = [
  { key: "2026-11-06", name: "Friday", dateLabel: "Nov 6" },
  { key: "2026-11-07", name: "Saturday", dateLabel: "Nov 7" },
  { key: "2026-11-08", name: "Sunday", dateLabel: "Nov 8" },
] as const;

/** The days the backstage editor offers: the conference plus setup and teardown. */
export const EDITOR_DAYS = [
  { key: "2026-11-05", name: "Thursday", dateLabel: "Nov 5" },
  ...CONFERENCE_DAYS,
  { key: "2026-11-09", name: "Monday", dateLabel: "Nov 9" },
] as const;

type DayLabel = { key: string; name: string; dateLabel: string };

export const PACIFIC = "America/Los_Angeles";

const wallFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

type Wall = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function pacificParts(date: Date): Wall {
  const o: Record<string, number> = {};
  for (const p of wallFormat.formatToParts(date)) {
    if (p.type !== "literal") o[p.type] = Number(p.value);
  }
  // Some ICU builds print midnight as 24.
  return {
    year: o.year,
    month: o.month,
    day: o.day,
    hour: o.hour % 24,
    minute: o.minute,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-11-06" in Pacific time. */
export function pacificDayKey(iso: string): string {
  const p = pacificParts(new Date(iso));
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Minutes since Pacific midnight. */
export function pacificMinutes(iso: string): number {
  const p = pacificParts(new Date(iso));
  return p.hour * 60 + p.minute;
}

/** The datetime-local value ("2026-11-06T14:00") for an instant, in Pacific. */
export function toPacificWall(iso: string): string {
  const p = pacificParts(new Date(iso));
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * The instant a Pacific wall-clock time names, or null if malformed. Two
 * correction passes so a time near a DST switch lands on the right offset.
 */
export function fromPacificWall(wall: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(wall.trim());
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const p = pacificParts(new Date(guess));
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += target - shown;
  }
  const date = new Date(guess);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatPacificTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

export function formatPacificDay(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

export function slotLabel(
  slotStart: number,
  { period = true }: { period?: boolean } = {},
): string {
  const h = Math.floor(slotStart / 60);
  const m = slotStart % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  if (!period) return `${h12}:${pad(m)}`;
  return `${h12}:${pad(m)} ${h >= 12 ? "PM" : "AM"}`;
}

/** "14:30" from minutes since midnight. */
export function minutesToHHMM(min: number): string {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

// Default lengths end five minutes before the half hour, leaving a passing
// period. Any start and end is allowed; this only shapes the defaults.
export const END_GAP_MINUTES = 5;

const MIDNIGHT = 24 * 60;

/** The default end for a start: the shortest slot, capped at midnight. */
export function defaultEnd(start: number): number {
  return Math.min(start + 30 - END_GAP_MINUTES, MIDNIGHT);
}

/**
 * Where the end goes when the start moves: the length kept, cut back to
 * midnight if it would run past (`capped`).
 */
export function movedEnd(
  start: number | null,
  end: number | null,
  next: number,
): { end: number; capped: boolean } {
  if (start === null || end === null || end <= start)
    return { end: defaultEnd(next), capped: false };
  const moved = next + (end - start);
  return { end: Math.min(moved, MIDNIGHT), capped: moved > MIDNIGHT };
}

/** The times cut back to end at midnight after the start, with the length they had if that cut anything. */
export function capAtMidnight(times: { startsAt: Date; endsAt: Date }): {
  startsAt: Date;
  endsAt: Date;
  cutFromMinutes: number | null;
} {
  const midnight = fromPacificWall(
    wallAt(pacificDayKey(times.startsAt.toISOString()), MIDNIGHT),
  )!;
  if (times.endsAt <= midnight) return { ...times, cutFromMinutes: null };
  return {
    startsAt: times.startsAt,
    endsAt: midnight,
    cutFromMinutes:
      (times.endsAt.getTime() - times.startsAt.getTime()) / 60_000,
  };
}

/** "1h 30m", "45m", "2h". */
export function formatLength(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return [h ? `${h}h` : "", m || !h ? `${m}m` : ""].filter(Boolean).join(" ");
}

/** A session's end in minutes past its start day's midnight; the next midnight is 1440. */
export function endMinutes(startsAt: string, endsAt: string): number {
  const min = pacificMinutes(endsAt);
  return min === 0 && pacificDayKey(endsAt) !== pacificDayKey(startsAt)
    ? MIDNIGHT
    : min;
}

/** The wall time `minutes` past midnight on `dayKey`, 1440 being the next day's 00:00. */
export function wallAt(dayKey: string, minutes: number): string {
  if (minutes < MIDNIGHT) return `${dayKey}T${minutesToHHMM(minutes)}`;
  const [y, m, d] = dayKey.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return `${next}T${minutesToHHMM(minutes - MIDNIGHT)}`;
}

// Where the grid starts by default (Friday 2pm, otherwise 10am). Not a limit:
// the grid reaches earlier for an earlier session.
const OPENS_AT = 10 * 60;
const DAY_OPENS_AT: Record<string, number> = { "2026-11-06": 14 * 60 };
const CLOSES_AT = MIDNIGHT;

export function opensAt(dayKey: string): number {
  return DAY_OPENS_AT[dayKey] ?? OPENS_AT;
}

/** Why a session at these times falls outside schedule hours, or null. */
export function outsideHours(
  startsAt: Date,
  endsAt: Date,
): { field: "startsAt" | "endsAt"; error: string } | null {
  const start = pacificMinutes(startsAt.toISOString());
  const end = start + (endsAt.getTime() - startsAt.getTime()) / 60_000;
  if (end > CLOSES_AT)
    return { field: "endsAt", error: "Sessions end by midnight." };
  return null;
}

// Grid geometry, matching the 2025 schedule component.
const PX_PER_MIN = 2;
export const SLOT_MINUTES = 30;
export const SLOT_PX = SLOT_MINUTES * PX_PER_MIN;

type Timed = Pick<ScheduleSession, "startsAt" | "endsAt">;

/** A session with both times set; the grid only places these. */
export type Placed<S extends Timed> = S & { startsAt: string; endsAt: string };
export type PlacedSession = Placed<ScheduleSession>;

export function isPlaced<S extends Timed>(s: S): s is Placed<S> {
  return s.startsAt !== null && s.endsAt !== null;
}

export function offsetPx(session: Placed<Timed>, slotStart: number): number {
  return Math.max(0, pacificMinutes(session.startsAt) - slotStart) * PX_PER_MIN;
}

/** Pixels down the day grid for the current Pacific time, or null if `now` isn't on `dayKey` or is outside the grid's hours. */
export function nowLinePx(
  dayKey: string,
  firstSlot: number,
  now: Date,
): number | null {
  const iso = now.toISOString();
  if (pacificDayKey(iso) !== dayKey) return null;
  const minutes =
    pacificMinutes(iso) +
    (now.getUTCSeconds() + now.getUTCMilliseconds() / 1000) / 60;
  return minutes < firstSlot ? null : (minutes - firstSlot) * PX_PER_MIN;
}

export function heightPx(session: Placed<Timed>): number {
  const dur = pacificMinutes(session.endsAt) - pacificMinutes(session.startsAt);
  return Math.max(SLOT_PX, dur * PX_PER_MIN);
}

export function startsInSlot(
  session: Placed<Timed>,
  slotStart: number,
): boolean {
  const m = pacificMinutes(session.startsAt);
  return m >= slotStart && m < slotStart + SLOT_MINUTES;
}

/** An unplaced draft dropped on the grid gets an hour, ending on the passing period. */
export const DEFAULT_DRAFT_MINUTES = 60;

type Times = Pick<ScheduleSession, "startsAt" | "endsAt">;

/** Where a session lands when moved to start at `start`: its length kept, or the draft default. */
export function movedTimes(
  session: Times,
  start: Date,
): { startsAt: Date; endsAt: Date } {
  const ms =
    session.startsAt && session.endsAt
      ? Date.parse(session.endsAt) - Date.parse(session.startsAt)
      : (DEFAULT_DRAFT_MINUTES - END_GAP_MINUTES) * 60_000;
  return { startsAt: start, endsAt: new Date(start.getTime() + ms) };
}

/** Volunteer shifts hand off with some overlap; a double-booked real room is a mistake. */
export function roomAllowsOverlap(visibility: LocationVisibility): boolean {
  return visibility === "volunteer";
}

/** A session a save overlaps, in a room that forbids overlap. */
export type RoomClash = {
  title: string;
  room: string;
  startsAt: string;
  endsAt: string;
};

/** '"Chess" in Eigen Hall (10:00 AM–10:55 AM)' */
export function clashDescription(clash: RoomClash): string {
  return `"${clash.title}" in ${clash.room} (${formatPacificTime(clash.startsAt)}–${formatPacificTime(clash.endsAt)})`;
}

/** The note an API save that double-books a room comes back with. */
export function overlapWarning(clash: RoomClash): string {
  return `Saved, but this overlaps ${clashDescription(clash)}.`;
}

/** The clash shape both the conflict dialog and the API warning read. */
export function toRoomClash(
  other: { title: string; startsAt: string | Date; endsAt: string | Date },
  room: string,
): RoomClash {
  const iso = (t: string | Date) =>
    typeof t === "string" ? t : t.toISOString();
  return {
    title: other.title,
    room,
    startsAt: iso(other.startsAt),
    endsAt: iso(other.endsAt),
  };
}

/**
 * The session already in that room at that time, if any. "No room" and
 * rooms that allow overlap never clash.
 */
export function findClash(
  sessions: ScheduleSession[],
  move: { id: string; locationId: string | null; startsAt: Date; endsAt: Date },
  locations: Pick<ScheduleLocation, "id" | "name" | "visibility">[],
): RoomClash | null {
  if (move.locationId === null) return null;
  const room = locations.find((l) => l.id === move.locationId);
  if (!room || roomAllowsOverlap(room.visibility)) return null;
  const other = sessions
    .filter(isPlaced)
    .find(
      (s) =>
        s.id !== move.id &&
        s.locationId === move.locationId &&
        Date.parse(s.startsAt) < move.endsAt.getTime() &&
        Date.parse(s.endsAt) > move.startsAt.getTime(),
    );
  return other ? toRoomClash(other, room.name) : null;
}

/** Grid column id for placed sessions with no room. */
export const NO_ROOM = "__none__";

/** The sessions a grid cell draws: in that column, starting in that slot. */
export function cellSessions<S extends Timed & { locationId: string | null }>(
  sessions: Placed<S>[],
  columnId: string,
  slotStart: number,
): Placed<S>[] {
  return sessions.filter(
    (s) => (s.locationId ?? NO_ROOM) === columnId && startsInSlot(s, slotStart),
  );
}

/** Where a block sits across its column: lane `lane` of `lanes` side by side. */
export type Lane = { lane: number; lanes: number };

/**
 * Side-by-side lanes for sessions that overlap in the same column, keyed by
 * session id. Each run of overlapping sessions splits the column evenly.
 */
export function overlapLanes<
  S extends Timed & { id: string; locationId: string | null },
>(sessions: Placed<S>[]): Map<string, Lane> {
  const out = new Map<string, Lane>();
  const byColumn = new Map<string, Placed<S>[]>();
  for (const s of sessions) {
    const col = s.locationId ?? NO_ROOM;
    const list = byColumn.get(col);
    if (list) list.push(s);
    else byColumn.set(col, [s]);
  }
  for (const column of byColumn.values()) {
    const sorted = column
      .map((s) => ({
        id: s.id,
        start: Date.parse(s.startsAt),
        end: Date.parse(s.endsAt),
      }))
      .sort((a, b) => a.start - b.start || b.end - a.end);
    let run: string[] = [];
    let laneEnds: number[] = [];
    let runEnd = -Infinity;
    const close = () => {
      for (const id of run) out.get(id)!.lanes = laneEnds.length;
      run = [];
      laneEnds = [];
    };
    for (const s of sorted) {
      if (s.start >= runEnd) close();
      let lane = laneEnds.findIndex((end) => end <= s.start);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = s.end;
      out.set(s.id, { lane, lanes: 1 });
      run.push(s.id);
      runEnd = Math.max(runEnd, s.end);
    }
    close();
  }
  return out;
}

/** Inline left/right for a block in its lane, keeping the 2px gutter. */
export function laneInset(lane: Lane | undefined): {
  left?: string;
  right?: string;
} {
  if (!lane || lane.lanes <= 1) return {};
  const pct = 100 / lane.lanes;
  return {
    left: `calc(${lane.lane * pct}% + 2px)`,
    right: `calc(${(lane.lanes - lane.lane - 1) * pct}% + 2px)`,
  };
}

export type Day<S extends Timed = ScheduleSession> = {
  key: string;
  name: string;
  dateLabel: string;
  sessions: Placed<S>[];
  /** 30-minute slot starts (minutes since Pacific midnight), open to midnight. */
  slots: number[];
};

/** The day's slots; reaches earlier only to show a session saved before opening. */
function daySlots(dayKey: string, sessions: Placed<Timed>[]): number[] {
  const earliest = Math.min(
    opensAt(dayKey),
    ...sessions.map((s) => pacificMinutes(s.startsAt)),
  );
  const first = earliest - (earliest % SLOT_MINUTES);
  const out: number[] = [];
  for (let m = first; m < CLOSES_AT; m += SLOT_MINUTES) out.push(m);
  return out;
}

/**
 * Buckets placed sessions by Pacific day. `always` (the three conference
 * days unless given) always appear; any other day a session lands on is
 * added too so nothing is hidden. Days come out in date order.
 */
export function buildDays<S extends Timed>(
  sessions: S[],
  always: readonly DayLabel[] = CONFERENCE_DAYS,
): Day<S>[] {
  const placed = sessions
    .filter((s): s is Placed<S> => isPlaced(s))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const byKey = new Map<string, Placed<S>[]>();
  for (const s of placed) {
    const key = pacificDayKey(s.startsAt);
    byKey.set(key, [...(byKey.get(key) ?? []), s]);
  }

  const days: DayLabel[] = [...always];
  for (const key of [...byKey.keys()].sort()) {
    if (days.some((d) => d.key === key)) continue;
    const iso = byKey.get(key)![0].startsAt;
    days.push({
      key,
      name: new Intl.DateTimeFormat("en-US", {
        timeZone: PACIFIC,
        weekday: "long",
      }).format(new Date(iso)),
      dateLabel: new Intl.DateTimeFormat("en-US", {
        timeZone: PACIFIC,
        month: "short",
        day: "numeric",
      }).format(new Date(iso)),
    });
  }

  days.sort((a, b) => a.key.localeCompare(b.key));
  return days.map((day) => {
    const sessions = byKey.get(day.key) ?? [];
    return { ...day, sessions, slots: daySlots(day.key, sessions) };
  });
}

/** The tab to open on: the conference's first day, even when an earlier day is shown. */
export function openingDayKey(days: { key: string }[]): string {
  const first = CONFERENCE_DAYS[0].key;
  return days.some((d) => d.key === first) ? first : (days[0]?.key ?? first);
}

/**
 * The tab selected by key, or the opening day once that day is gone. Tabs are
 * picked by key, not position, because a session saved on an earlier day adds
 * a tab in front.
 */
export function selectedDay<D extends { key: string }>(
  days: D[],
  key: string,
): D {
  return (
    days.find((d) => d.key === key) ??
    days.find((d) => d.key === openingDayKey(days)) ??
    days[0]
  );
}

/** What the public schedule may show of a session: published only, hosts without emails. */
export type PublicSession = Pick<
  ScheduleSession,
  | "id"
  | "slug"
  | "title"
  | "description"
  | "category"
  | "locationId"
  | "maxCapacity"
  | "ages"
  | "rsvpIsCommitment"
  | "sponsored"
> & { startsAt: string; endsAt: string; hosts: { name: string }[] };

export type PublicLocation = Pick<
  ScheduleLocation,
  "id" | "name" | "capacity" | "campusLocation" | "thumbnailUrl" | "imageUrl"
>;

/** How far down the room visibility levels a viewer may see. */
export type ScheduleViewer = "public" | "volunteer" | "team";

/**
 * Whether this viewer may see a room at all — the one rule, exported so the
 * profile pages decide it the same way the schedule does rather than growing
 * their own copy.
 */
export function roomVisible(
  location: ScheduleLocation,
  viewer: ScheduleViewer,
): boolean {
  if (viewer === "team") return true;
  if (location.visibility === "public") return true;
  if (location.visibility === "volunteer") return viewer === "volunteer";
  // "hidden" means team only, with no exception for a room that happens to
  // hold a published session — that exception made every such room public.
  return false;
}

/**
 * The published, placed sessions and the rooms to show them in, as much of
 * each as this viewer may see (see ScheduleLocation.visibility). A session in
 * a room the viewer can't see is dropped with it, so nothing leaks through
 * the list view or a session page.
 */
export function publicSchedule(
  schedule: {
    locations: ScheduleLocation[];
    sessions: ScheduleSession[];
  },
  viewer: ScheduleViewer = "public",
): { locations: PublicLocation[]; sessions: PublicSession[] } {
  const placed = schedule.sessions
    .filter((s) => s.status === "published")
    .filter(isPlaced);
  const rooms = schedule.locations.filter((l) => roomVisible(l, viewer));
  const shown = new Set(rooms.map((l) => l.id));
  const sessions: PublicSession[] = placed
    .filter((s) => s.locationId === null || shown.has(s.locationId))
    .map((s) => ({
      id: s.id,
      slug: s.slug,
      title: s.title,
      description: s.description,
      category: s.category,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      locationId: s.locationId,
      maxCapacity: s.maxCapacity,
      ages: s.ages,
      rsvpIsCommitment: s.rsvpIsCommitment,
      sponsored: s.sponsored,
      hosts: s.hosts.map((h) => ({ name: publicAccountName(h) })),
    }));
  const locations = rooms.map((l) => ({
    id: l.id,
    name: l.name,
    capacity: l.capacity,
    campusLocation: l.campusLocation,
    thumbnailUrl: l.thumbnailUrl,
    imageUrl: l.imageUrl,
  }));
  return { locations, sessions };
}

/**
 * The ids of the sessions a viewer is in: hosting, shepherding, RSVP'd to
 * (waitlist included) or bookmarked. Only ids from `sessions` come back, so
 * plans on sessions the caller left out (drafts, hidden rooms) stay out.
 */
export function viewerSessionIds(
  userId: string,
  sessions: Pick<ScheduleSession, "id" | "hosts" | "shepherd">[],
  plans: ViewerPlans,
): string[] {
  const marked = new Set(plans.bookmarks);
  return sessions
    .filter(
      (s) =>
        s.hosts.some((h) => h.userId === userId) ||
        s.shepherd?.userId === userId ||
        plans.rsvps[s.id] ||
        marked.has(s.id),
    )
    .map((s) => s.id);
}

/** The days with only the given sessions left; tabs and time slots stay put. */
export function onlySessions<D extends { sessions: { id: string }[] }>(
  days: D[],
  ids: ReadonlySet<string>,
): D[] {
  return days.map((d) => ({
    ...d,
    sessions: d.sessions.filter((s) => ids.has(s.id)),
  }));
}

/** "my-session-title" from "My Session Title!", capped so slugs stay short. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
