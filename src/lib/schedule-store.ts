import {
  and,
  asc,
  count,
  eq,
  gt,
  ilike,
  inArray,
  like,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { getDb, schema } from "@/db";
import { can } from "./access";
import { getAuth } from "./auth";
import type { HostSessionFields } from "./schedule-input";
import {
  clashDescription,
  fromPacificWall,
  movedTimes,
  outsideHours,
  roomAllowsOverlap,
  summarizeRsvps,
  toRoomClash,
  type Attendance,
  type RoomClash,
  type RsvpStatus,
  type ScheduleAccount,
  type ViewerPlans,
  type ScheduleLocation,
  type ScheduleSession,
  type SessionRsvps,
} from "./schedule";

const { locations, sessions, sessionHosts, rsvps, bookmarks, user } = schema;

// Matches accountLabel(): account name, else email.
export const accountName = sql<string>`coalesce(nullif(trim(${user.name}), ''), ${user.email})`;

// The same rule without the email, for names other attendees see. Code
// sign-in can leave the account name blank.
const publicName = sql<string>`coalesce(nullif(trim(${user.name}), ''), 'Someone')`;

const accountColumns = {
  userId: user.id,
  name: accountName,
  email: user.email,
};

export type Schedule = {
  locations: ScheduleLocation[];
  sessions: ScheduleSession[];
};

export async function loadSchedule(): Promise<Schedule> {
  const db = getDb();
  const [locs, sess, hosts, shepherds] = await Promise.all([
    db
      .select()
      .from(locations)
      .orderBy(asc(locations.displayOrder), asc(locations.name)),
    db
      .select()
      .from(sessions)
      .orderBy(asc(sessions.startsAt), asc(sessions.title)),
    db
      .select({ sessionId: sessionHosts.sessionId, ...accountColumns })
      .from(sessionHosts)
      .innerJoin(user, eq(user.id, sessionHosts.userId))
      .orderBy(asc(sessionHosts.sessionId), asc(sessionHosts.position)),
    db
      .select({ sessionId: sessions.id, ...accountColumns })
      .from(sessions)
      .innerJoin(user, eq(user.id, sessions.shepherdUserId)),
  ]);
  const shepherdBySession = new Map(
    shepherds.map(({ sessionId, ...account }) => [sessionId, account]),
  );
  const hostsBySession = new Map<string, ScheduleAccount[]>();
  for (const { sessionId, ...host } of hosts) {
    hostsBySession.set(sessionId, [
      ...(hostsBySession.get(sessionId) ?? []),
      host,
    ]);
  }
  return {
    locations: locs.map((l) => ({
      id: l.id,
      name: l.name,
      capacity: l.capacity,
      campusLocation: l.campusLocation,
      description: l.description,
      displayOrder: l.displayOrder,
      visibility: l.visibility,
      thumbnailUrl: l.thumbnailUrl,
      imageUrl: l.imageUrl,
    })),
    sessions: sess.map((s) => ({
      id: s.id,
      slug: s.slug,
      title: s.title,
      description: s.description,
      category: s.category,
      startsAt: s.startsAt?.toISOString() ?? null,
      endsAt: s.endsAt?.toISOString() ?? null,
      locationId: s.locationId,
      maxCapacity: s.maxCapacity,
      minCapacity: s.minCapacity,
      ages: s.ages,
      needs: s.needs,
      status: s.status,
      rsvpIsCommitment: s.rsvpIsCommitment,
      sponsored: s.sponsored,
      airtableRfpRecordId: s.airtableRfpRecordId,
      hosts: hostsBySession.get(s.id) ?? [],
      shepherd: shepherdBySession.get(s.id) ?? null,
    })),
  };
}

export type SessionInput = Omit<
  ScheduleSession,
  "id" | "startsAt" | "endsAt" | "hosts" | "shepherd" | "airtableRfpRecordId"
> & {
  id?: string;
  /** Left as stored when undefined. */
  airtableRfpRecordId?: string | null;
  /** Left as stored when undefined. */
  shepherdUserId?: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  /** User ids, lead first. */
  hostIds: string[];
};

/**
 * Inserts or, with an id, replaces the session and its host list. Refuses a
 * clash in its room unless `allowOverlap`; a clash let through comes back.
 * Only a change of time or room is checked, so editing the rest of a session
 * that already overlaps doesn't ask again.
 */
export async function upsertSession(
  input: SessionInput,
  { allowOverlap = false }: { allowOverlap?: boolean } = {},
): Promise<{ id: string; clash: RoomClash | null }> {
  const db = getDb();
  const { id, hostIds, ...row } = input;
  const clash =
    row.startsAt && row.endsAt && (await placementChanged(id, row))
      ? await assertSlotFree(
          id ?? null,
          row.startsAt,
          row.endsAt,
          row.locationId,
          allowOverlap,
        )
      : null;
  let sessionId: string;
  if (id) {
    const [updated] = await db
      .update(sessions)
      .set(row)
      .where(eq(sessions.id, id))
      .returning({ id: sessions.id });
    if (!updated) throw new Error("That session no longer exists.");
    sessionId = updated.id;
  } else {
    const [inserted] = await db
      .insert(sessions)
      .values(row)
      .returning({ id: sessions.id });
    sessionId = inserted.id;
  }
  const remove = db
    .delete(sessionHosts)
    .where(eq(sessionHosts.sessionId, sessionId));
  if (hostIds.length === 0) {
    await remove;
  } else {
    await db.batch([
      remove,
      db
        .insert(sessionHosts)
        .values(
          hostIds.map((userId, position) => ({ sessionId, position, userId })),
        ),
    ]);
  }
  // A raised capacity frees seats for the waitlist.
  if (id) await promoteWaitlist(sessionId);
  return { id: sessionId, clash };
}

async function placementChanged(
  id: string | undefined,
  next: Pick<SessionInput, "startsAt" | "endsAt" | "locationId">,
): Promise<boolean> {
  if (!id) return true;
  const [stored] = await getDb()
    .select({
      startsAt: sessions.startsAt,
      endsAt: sessions.endsAt,
      locationId: sessions.locationId,
    })
    .from(sessions)
    .where(eq(sessions.id, id));
  return (
    !stored ||
    stored.locationId !== next.locationId ||
    stored.startsAt?.getTime() !== next.startsAt?.getTime() ||
    stored.endsAt?.getTime() !== next.endsAt?.getTime()
  );
}

/** The session's hosts as user ids, lead first. */
export async function sessionHostIds(sessionId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ userId: sessionHosts.userId })
    .from(sessionHosts)
    .where(eq(sessionHosts.sessionId, sessionId))
    .orderBy(asc(sessionHosts.position));
  return rows.map((r) => r.userId);
}

/** Replaces a session's host list, lead first. Touches nothing else. */
export async function setSessionHosts(
  sessionId: string,
  hostIds: string[],
): Promise<void> {
  const db = getDb();
  const remove = db
    .delete(sessionHosts)
    .where(eq(sessionHosts.sessionId, sessionId));
  if (hostIds.length === 0) {
    await remove;
    return;
  }
  await db.batch([
    remove,
    db
      .insert(sessionHosts)
      .values(
        hostIds.map((userId, position) => ({ sessionId, position, userId })),
      ),
  ]);
}

/**
 * The columns a session's own host may change. Separate from upsertSession,
 * which replaces the whole row: this update names no placement or status
 * column, so nothing here can move a session or publish it even by mistake.
 */
export async function updateSessionAsHost(
  sessionId: string,
  fields: HostSessionFields,
): Promise<void> {
  const [updated] = await getDb()
    .update(sessions)
    .set({
      title: fields.title,
      description: fields.description,
      category: fields.category,
      maxCapacity: fields.maxCapacity,
      minCapacity: fields.minCapacity,
      ages: fields.ages,
      needs: fields.needs,
      rsvpIsCommitment: fields.rsvpIsCommitment,
    })
    .where(eq(sessions.id, sessionId))
    .returning({ id: sessions.id });
  if (!updated) throw new Error("That session no longer exists.");
  // A raised capacity frees seats for the waitlist.
  await promoteWaitlist(sessionId);
}

/**
 * Moves a session to a room and start time, keeping its length unless `end`
 * is given; refuses a clash unless `allowOverlap`.
 */
export async function moveSessionTo(
  id: string,
  start: Date,
  locationId: string | null,
  allowOverlap = false,
  end?: Date,
): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ startsAt: sessions.startsAt, endsAt: sessions.endsAt })
    .from(sessions)
    .where(eq(sessions.id, id));
  if (!row) throw new Error("That session no longer exists.");
  const { startsAt, endsAt } = end
    ? { startsAt: start, endsAt: end }
    : movedTimes(
        {
          startsAt: row.startsAt?.toISOString() ?? null,
          endsAt: row.endsAt?.toISOString() ?? null,
        },
        start,
      );
  if (endsAt <= startsAt) throw new Error("End must be after start.");
  await assertSlotFree(id, startsAt, endsAt, locationId, allowOverlap);
  await db
    .update(sessions)
    .set({ startsAt, endsAt, locationId })
    .where(eq(sessions.id, id));
}

/** A save refused for double-booking a room; the caller may offer to override. */
export class OverlapError extends Error {
  constructor(readonly clash: RoomClash) {
    super(`That overlaps ${clashDescription(clash)}.`);
  }
}

/**
 * Throws when the times run past midnight, or overlap another session in a
 * room that forbids it unless `allowOverlap`. Returns the clash let through.
 */
export async function assertSlotFree(
  id: string | null,
  startsAt: Date,
  endsAt: Date,
  locationId: string | null,
  allowOverlap = false,
): Promise<RoomClash | null> {
  const outside = outsideHours(startsAt, endsAt);
  if (outside) throw new Error(outside.error);
  if (!locationId) return null;
  const clash = await roomClash(id, startsAt, endsAt, locationId);
  if (clash && !allowOverlap) throw new OverlapError(clash);
  return clash;
}

/** Another session these times overlap in a room that forbids overlap, if any. */
export async function roomClash(
  id: string | null,
  startsAt: Date,
  endsAt: Date,
  locationId: string,
): Promise<RoomClash | null> {
  const [row] = await getDb()
    .select({
      room: locations.name,
      visibility: locations.visibility,
      title: sessions.title,
      startsAt: sessions.startsAt,
      endsAt: sessions.endsAt,
    })
    .from(locations)
    .leftJoin(
      sessions,
      and(
        eq(sessions.locationId, locations.id),
        id ? ne(sessions.id, id) : undefined,
        lt(sessions.startsAt, endsAt),
        gt(sessions.endsAt, startsAt),
      ),
    )
    .where(eq(locations.id, locationId))
    .limit(1);
  if (!row || roomAllowsOverlap(row.visibility)) return null;
  if (!row.title || !row.startsAt || !row.endsAt) return null;
  return toRoomClash(
    { title: row.title, startsAt: row.startsAt, endsAt: row.endsAt },
    row.room,
  );
}

/** Accounts whose name or email contains the query. */
export async function searchAccounts(
  query: string,
): Promise<ScheduleAccount[]> {
  const q = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  return getDb()
    .select(accountColumns)
    .from(user)
    .where(or(ilike(user.name, q), ilike(user.email, q)))
    .orderBy(asc(accountName))
    .limit(8);
}

/**
 * The account for this email, made if there is none. A made account is
 * unverified and has no password; signing in with a code claims it.
 */
export async function ensureAccount(
  name: string,
  email: string,
): Promise<ScheduleAccount> {
  const existing = await findAccount(email);
  if (existing) return existing;
  await getAuth().api.createUser({ body: { email, name } });
  return (await findAccount(email))!;
}

export async function findAccount(
  email: string,
): Promise<ScheduleAccount | null> {
  const [found] = await getDb()
    .select(accountColumns)
    .from(user)
    .where(eq(user.email, email.toLowerCase()))
    .limit(1);
  return found ?? null;
}

export async function sessionIdBySlug(slug: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.slug, slug))
    .limit(1);
  return row?.id ?? null;
}

export type RsvpCounts = Record<string, { going: number; waitlist: number }>;

/** Going and waitlisted per session id; sessions with no RSVPs are absent. */
export async function loadRsvpCounts(): Promise<RsvpCounts> {
  const rows = await getDb()
    .select({ sessionId: rsvps.sessionId, status: rsvps.status, n: count() })
    .from(rsvps)
    .groupBy(rsvps.sessionId, rsvps.status);
  const out: RsvpCounts = {};
  for (const { sessionId, status, n } of rows) {
    (out[sessionId] ??= { going: 0, waitlist: 0 })[status] = n;
  }
  return out;
}

/** True when the error is the rsvps_capacity trigger refusing a seat. */
function isFull(err: unknown): boolean {
  for (
    let e: unknown = err;
    e && typeof e === "object";
    e = (e as { cause?: unknown }).cause
  ) {
    if ((e as { constraint?: unknown }).constraint === "rsvps_capacity")
      return true;
  }
  return false;
}

/**
 * A going RSVP, or a waitlist spot when the session is full. Re-RSVPing keeps
 * an existing seat, and retries a waitlisted one.
 */
export async function rsvp(
  sessionId: string,
  userId: string,
): Promise<RsvpStatus> {
  const db = getDb();
  const mine = and(eq(rsvps.sessionId, sessionId), eq(rsvps.userId, userId));
  // The capacity trigger runs before ON CONFLICT is considered, so an upsert
  // would refuse someone already seated; branch on the existing row instead.
  const [existing] = await db
    .select({ status: rsvps.status })
    .from(rsvps)
    .where(mine)
    .limit(1);
  if (existing?.status === "going") return "going";
  try {
    if (existing) {
      await db.update(rsvps).set({ status: "going" }).where(mine);
    } else {
      await db
        .insert(rsvps)
        .values({ sessionId, userId, status: "going" })
        .onConflictDoNothing();
    }
    return "going";
  } catch (err) {
    if (!isFull(err)) throw err;
    await db
      .insert(rsvps)
      .values({ sessionId, userId, status: "waitlist" })
      .onConflictDoNothing();
    return "waitlist";
  }
}

/** Drops the RSVP, then moves the waitlist up into any freed seat. */
export async function cancelRsvp(
  sessionId: string,
  userId: string,
): Promise<void> {
  await getDb()
    .delete(rsvps)
    .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.userId, userId)));
  await promoteWaitlist(sessionId);
}

/** Seats waitlisted people, earliest first, until the session is full. */
async function promoteWaitlist(sessionId: string): Promise<void> {
  const db = getDb();
  const waiting = await db
    .select({ userId: rsvps.userId })
    .from(rsvps)
    .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.status, "waitlist")))
    .orderBy(asc(rsvps.createdAt));
  for (const { userId } of waiting) {
    try {
      await db
        .update(rsvps)
        .set({ status: "going" })
        .where(and(eq(rsvps.sessionId, sessionId), eq(rsvps.userId, userId)));
    } catch (err) {
      if (isFull(err)) return;
      throw err;
    }
  }
}

export async function setBookmark(
  sessionId: string,
  userId: string,
  on: boolean,
): Promise<void> {
  const db = getDb();
  if (on) {
    await db
      .insert(bookmarks)
      .values({ sessionId, userId })
      .onConflictDoNothing();
  } else {
    await db
      .delete(bookmarks)
      .where(
        and(eq(bookmarks.sessionId, sessionId), eq(bookmarks.userId, userId)),
      );
  }
}

/** Every RSVP with names, plus bookmark counts. Organizer-only data. */
export async function loadAttendance(): Promise<Attendance> {
  const db = getDb();
  const [rows, marks] = await Promise.all([
    db
      .select({
        sessionId: rsvps.sessionId,
        status: rsvps.status,
        ...accountColumns,
      })
      .from(rsvps)
      .innerJoin(user, eq(user.id, rsvps.userId))
      .orderBy(asc(rsvps.createdAt)),
    db
      .select({ sessionId: bookmarks.sessionId, n: count() })
      .from(bookmarks)
      .groupBy(bookmarks.sessionId),
  ]);
  const out: Attendance = {};
  const entry = (id: string) => (out[id] ??= { attendees: [], bookmarks: 0 });
  for (const { sessionId, ...attendee } of rows)
    entry(sessionId).attendees.push(attendee);
  for (const { sessionId, n } of marks) entry(sessionId).bookmarks = n;
  return out;
}

export async function loadViewerPlans(userId: string): Promise<ViewerPlans> {
  const db = getDb();
  const [mine, marked] = await Promise.all([
    db
      .select({ sessionId: rsvps.sessionId, status: rsvps.status })
      .from(rsvps)
      .where(eq(rsvps.userId, userId)),
    db
      .select({ sessionId: bookmarks.sessionId })
      .from(bookmarks)
      .where(eq(bookmarks.userId, userId)),
  ]);
  return {
    rsvps: Object.fromEntries(mine.map((r) => [r.sessionId, r.status])),
    bookmarks: marked.map((b) => b.sessionId),
  };
}

/** Who's going, waitlisted and bookmarked for one session, earliest first. */
export async function loadSessionPlans(sessionId: string) {
  const db = getDb();
  const [rows, marked] = await Promise.all([
    db
      .select({ status: rsvps.status, ...accountColumns })
      .from(rsvps)
      .innerJoin(user, eq(user.id, rsvps.userId))
      .where(eq(rsvps.sessionId, sessionId))
      .orderBy(asc(rsvps.createdAt)),
    db
      .select(accountColumns)
      .from(bookmarks)
      .innerJoin(user, eq(user.id, bookmarks.userId))
      .where(eq(bookmarks.sessionId, sessionId))
      .orderBy(asc(bookmarks.createdAt)),
  ]);
  const with_ = (status: RsvpStatus) =>
    rows
      .filter((r) => r.status === status)
      .map(({ userId, name, email }) => ({ userId, name, email }));
  return {
    going: with_("going"),
    waitlist: with_("waitlist"),
    bookmarkedBy: marked,
  };
}

/**
 * One session's RSVPs for the public page. Names only for a viewer holding
 * schedule.rsvps (the Attendee role carries it by default, so a claimed
 * ticket is enough); everyone else gets counts.
 */
export async function loadSessionRsvps(
  sessionId: string,
): Promise<SessionRsvps> {
  const [showNames, rows] = await Promise.all([
    can("schedule.rsvps").then(Boolean),
    getDb()
      .select({ status: rsvps.status, name: publicName })
      .from(rsvps)
      .innerJoin(user, eq(user.id, rsvps.userId))
      .where(eq(rsvps.sessionId, sessionId))
      .orderBy(asc(rsvps.createdAt)),
  ]);
  return summarizeRsvps(rows, showNames);
}

/** One account's RSVPs and bookmarks, by session slug. */
export async function loadAccountPlans(userId: string) {
  const db = getDb();
  const session = { slug: sessions.slug, title: sessions.title };
  const [going, marked] = await Promise.all([
    db
      .select({ ...session, status: rsvps.status })
      .from(rsvps)
      .innerJoin(sessions, eq(sessions.id, rsvps.sessionId))
      .where(eq(rsvps.userId, userId))
      .orderBy(asc(sessions.startsAt)),
    db
      .select(session)
      .from(bookmarks)
      .innerJoin(sessions, eq(sessions.id, bookmarks.sessionId))
      .where(eq(bookmarks.userId, userId))
      .orderBy(asc(sessions.startsAt)),
  ]);
  return { rsvps: going, bookmarks: marked };
}

export async function removeSession(id: string): Promise<void> {
  await getDb().delete(sessions).where(eq(sessions.id, id));
}

export type LocationInput = Omit<ScheduleLocation, "id"> & { id?: string };

export async function upsertLocation(input: LocationInput): Promise<string> {
  const db = getDb();
  const { id, ...row } = input;
  if (id) {
    const [updated] = await db
      .update(locations)
      .set(row)
      .where(eq(locations.id, id))
      .returning({ id: locations.id });
    if (!updated) throw new Error("That location no longer exists.");
    return updated.id;
  }
  const [inserted] = await db
    .insert(locations)
    .values(row)
    .returning({ id: locations.id });
  return inserted.id;
}

export type RoomImages = Pick<ScheduleLocation, "thumbnailUrl" | "imageUrl">;

const imageColumns = {
  thumbnailUrl: locations.thumbnailUrl,
  imageUrl: locations.imageUrl,
};

/** Null when there's no such room. */
export async function locationImages(id: string): Promise<RoomImages | null> {
  const [row] = await getDb()
    .select(imageColumns)
    .from(locations)
    .where(eq(locations.id, id))
    .limit(1);
  return row ?? null;
}

export async function setLocationImages(
  id: string,
  images: RoomImages,
): Promise<void> {
  await getDb().update(locations).set(images).where(eq(locations.id, id));
}

/**
 * Sessions in the room keep their row; location_id goes null. Returns the
 * image URLs so the caller can delete the files.
 */
export async function removeLocation(id: string): Promise<RoomImages | null> {
  const [row] = await getDb()
    .delete(locations)
    .where(eq(locations.id, id))
    .returning(imageColumns);
  return row ?? null;
}

// Database constraints read back as sentences. Drizzle wraps the driver error,
// so look at the cause too.
const CONSTRAINT_MESSAGES: Record<string, { field?: string; error: string }> = {
  session_hosts_session_user_unique: {
    field: "hosts",
    error: "Someone is listed as a host twice.",
  },
  sessions_airtableRfpRecordId_unique: {
    field: "airtableRfpRecordId",
    error: "Another session already links that Airtable row.",
  },
  sessions_shepherd_user_id_user_id_fk: {
    field: "shepherd",
    error: "No account with that shepherd user id.",
  },
  sessions_slug_unique: {
    field: "slug",
    error: "Another session has that slug.",
  },
  sessions_ends_after_start: {
    field: "endsAt",
    error: "End must be after start.",
  },
  sessions_published_timed: {
    field: "status",
    error: "A published session needs a start and end time.",
  },
  sessions_max_capacity_positive: {
    field: "maxCapacity",
    error: "Max capacity must be at least 1.",
  },
  sessions_min_within_max: {
    field: "minCapacity",
    error: "Min capacity must be between 0 and the max.",
  },
  locations_image_url_https: {
    field: "thumbnail",
    error: "That image is too large; try a smaller one.",
  },
  locations_thumbnail_url_https: {
    field: "thumbnail",
    error: "That image is too large; try a smaller one.",
  },
  locations_capacity_positive: {
    field: "capacity",
    error: "Capacity must be at least 1.",
  },
};

export function explainDbError(err: unknown): {
  field?: string;
  error: string;
} {
  for (
    let e: unknown = err;
    e && typeof e === "object";
    e = (e as { cause?: unknown }).cause
  ) {
    const constraint = (e as { constraint?: unknown }).constraint;
    if (typeof constraint === "string" && CONSTRAINT_MESSAGES[constraint]) {
      return CONSTRAINT_MESSAGES[constraint];
    }
  }
  return { error: err instanceof Error ? err.message : String(err) };
}

// Sample data for an empty development database: the 2025 rooms and a
// weekend's worth of sessions across the three conference days. Slugs are
// prefixed so the set can be removed again without touching real rows.
export const SAMPLE_PREFIX = "sample-";
// Sample hosts are placeholder accounts; .invalid can never receive mail.
const SAMPLE_EMAIL_DOMAIN = "sample.invalid";
// Rooms the sample makes when there are none to borrow; the prefix keeps
// Remove from ever matching a real room.
const SAMPLE_ROOM_PREFIX = "Sample: ";

const SAMPLE_LOCATIONS = [
  {
    name: "Eigen Hall",
    capacity: 80,
    campusLocation: "Main building",
    displayOrder: 10,
  },
  {
    name: "The Clocktower",
    capacity: 30,
    campusLocation: "Upstairs",
    displayOrder: 20,
  },
  {
    name: "The Gardens",
    capacity: 40,
    campusLocation: "Outside",
    displayOrder: 30,
  },
  {
    name: "Playtesting Plaza",
    capacity: 25,
    campusLocation: "Courtyard",
    displayOrder: 40,
  },
];

type SampleSession = {
  title: string;
  category: ScheduleSession["category"];
  ages: ScheduleSession["ages"];
  room: string | null;
  day: "06" | "07" | "08";
  start: string;
  end: string;
  hosts: string[];
  maxCapacity?: number;
  status?: ScheduleSession["status"];
};

const SAMPLE_SESSIONS: SampleSession[] = [
  {
    title: "Opening ceremony",
    category: "other",
    ages: "all",
    room: "Eigen Hall",
    day: "06",
    start: "17:00",
    end: "17:25",
    hosts: ["Ricki Heicklen"],
    status: "published",
  },
  {
    title: "How to lose at everything",
    category: "talk",
    ages: "all",
    room: "Eigen Hall",
    day: "06",
    start: "18:00",
    end: "18:55",
    hosts: ["Ada Lovelace"],
    status: "published",
  },
  {
    title: "Build an escape room in 90 minutes",
    category: "workshop",
    ages: "adults",
    room: "The Clocktower",
    day: "06",
    start: "18:00",
    end: "19:25",
    hosts: ["Grace Hopper", "Alan Turing"],
    maxCapacity: 16,
    status: "published",
  },
  {
    title: "Giant chess",
    category: "game",
    ages: "kids",
    room: "The Gardens",
    day: "06",
    start: "18:30",
    end: "19:55",
    hosts: ["Isaac King"],
    status: "published",
  },
  {
    title: "Prediction markets 101",
    category: "talk",
    ages: "all",
    room: "Eigen Hall",
    day: "07",
    start: "10:00",
    end: "10:55",
    hosts: ["Robin Hanson"],
    status: "published",
  },
  {
    title: "Crossword construction",
    category: "workshop",
    ages: "all",
    room: "The Clocktower",
    day: "07",
    start: "10:00",
    end: "11:55",
    hosts: ["Will Shortz"],
    maxCapacity: 20,
    status: "published",
  },
  {
    title: "Human sudoku",
    category: "game",
    ages: "all",
    room: "The Gardens",
    day: "07",
    start: "11:00",
    end: "12:25",
    hosts: ["Simon Anthony"],
    maxCapacity: 36,
    status: "published",
  },
  {
    title: "Playtest: unreleased prototypes",
    category: "game",
    ages: "all",
    room: "Playtesting Plaza",
    day: "07",
    start: "13:00",
    end: "16:55",
    hosts: ["Elizabeth Hargrave"],
    status: "published",
  },
  {
    title: "The economics of board game design",
    category: "talk",
    ages: "all",
    room: "Eigen Hall",
    day: "07",
    start: "14:00",
    end: "14:55",
    hosts: ["Reiner Knizia"],
    status: "published",
  },
  {
    title: "LARP: the committee meeting",
    category: "game",
    ages: "adults",
    room: "The Clocktower",
    day: "07",
    start: "15:30",
    end: "17:55",
    hosts: ["Jason Morningstar"],
    maxCapacity: 12,
    status: "published",
  },
  {
    title: "Puzzle hunt wrap-up",
    category: "talk",
    ages: "all",
    room: "Eigen Hall",
    day: "08",
    start: "11:00",
    end: "11:55",
    hosts: ["Dan Katz"],
    status: "published",
  },
  {
    title: "Closing ceremony",
    category: "other",
    ages: "all",
    room: "Eigen Hall",
    day: "08",
    start: "16:00",
    end: "16:55",
    hosts: ["Ricki Heicklen", "Brian Smiley"],
    status: "published",
  },
  {
    title: "Megagame debrief (room TBD)",
    category: "other",
    ages: "all",
    room: null,
    day: "08",
    start: "13:00",
    end: "13:55",
    hosts: ["Jisk Kopczynski"],
    status: "draft",
  },
  {
    title: "Unplaced draft: speed Diplomacy",
    category: "game",
    ages: "adults",
    room: null,
    day: "08",
    start: "",
    end: "",
    hosts: ["Someone"],
    status: "draft",
  },
];

export async function insertSample(): Promise<void> {
  const db = getDb();
  const [existing] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(like(sessions.slug, `${SAMPLE_PREFIX}%`))
    .limit(1);
  if (existing) return;

  // Spread the sessions over real rooms when there are any; otherwise make
  // stand-ins.
  let rooms = await db
    .select({ id: locations.id })
    .from(locations)
    .orderBy(asc(locations.displayOrder), asc(locations.name))
    .limit(SAMPLE_LOCATIONS.length);
  if (rooms.length === 0) {
    rooms = await db
      .insert(locations)
      .values(
        SAMPLE_LOCATIONS.map((l) => ({
          ...l,
          name: SAMPLE_ROOM_PREFIX + l.name,
          visibility: "public" as const,
        })),
      )
      .returning({ id: locations.id });
  }
  const roomId = new Map(
    SAMPLE_LOCATIONS.map((l, i) => [l.name, rooms[i % rooms.length].id]),
  );

  for (const s of SAMPLE_SESSIONS) {
    const slug = `${SAMPLE_PREFIX}${s.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}`;
    const [row] = await db
      .insert(sessions)
      .values({
        slug,
        title: s.title,
        description: `Sample session. ${s.title} is here so the grid has something in it; edit or delete freely.`,
        category: s.category,
        ages: s.ages,
        startsAt: s.start
          ? fromPacificWall(`2026-11-${s.day}T${s.start}`)
          : null,
        endsAt: s.end ? fromPacificWall(`2026-11-${s.day}T${s.end}`) : null,
        locationId: s.room ? (roomId.get(s.room) ?? null) : null,
        maxCapacity: s.maxCapacity ?? null,
        status: s.status ?? "draft",
      })
      .returning({ id: sessions.id });
    const hostIds: string[] = [];
    for (const name of s.hosts) {
      const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@${SAMPLE_EMAIL_DOMAIN}`;
      hostIds.push((await ensureAccount(name, email)).userId);
    }
    await db.insert(sessionHosts).values(
      hostIds.map((userId, position) => ({
        sessionId: row.id,
        position,
        userId,
      })),
    );
  }
}

/** Removes the sample sessions and hosts, then any sample room nothing else uses. */
export async function removeSample(): Promise<void> {
  const db = getDb();
  await db.delete(sessions).where(like(sessions.slug, `${SAMPLE_PREFIX}%`));
  await db.delete(user).where(like(user.email, `%@${SAMPLE_EMAIL_DOMAIN}`));
  const rooms = await db
    .select({ id: locations.id })
    .from(locations)
    .where(like(locations.name, `${SAMPLE_ROOM_PREFIX}%`));
  if (rooms.length === 0) return;
  const used = new Set(
    (
      await db
        .selectDistinct({ id: sessions.locationId })
        .from(sessions)
        .where(
          inArray(
            sessions.locationId,
            rooms.map((r) => r.id),
          ),
        )
    ).map((r) => r.id),
  );
  const unused = rooms.map((r) => r.id).filter((id) => !used.has(id));
  if (unused.length > 0) {
    await db.delete(locations).where(inArray(locations.id, unused));
  }
}
