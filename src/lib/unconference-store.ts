import { and, asc, count, eq, inArray, lte, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { can } from "./access";
import { currentSession } from "./auth";
import type { NoticeDoc } from "./notice-doc";
import { pacificDayKey } from "./schedule";
import {
  clampNotePosition,
  noteEditor,
  noteRateWindowExpiry,
  summarizeReactions,
  type NoteColor,
  type NoteEditor,
  type NoteFields,
  type Reaction,
  type UnconferenceNote,
} from "./unconference";

const {
  sessionHosts,
  sessions,
  unconferenceNotes,
  unconferenceNoteReactions,
  user,
  verification,
} = schema;

// Notes are read by anyone who can see the schedule, so the author's email is
// never part of the name; a code sign-in can leave the account name blank.
const authorName = sql<string>`coalesce(nullif(trim(${user.name}), ''), 'Someone')`;

const noteColumns = {
  id: unconferenceNotes.id,
  locationId: unconferenceNotes.locationId,
  boardDay: unconferenceNotes.boardDay,
  sessionId: unconferenceNotes.sessionId,
  sessionSlug: sessions.slug,
  sessionTitle: sessions.title,
  sessionDescription: sessions.description,
  sessionStatus: sessions.status,
  sessionStartsAt: sessions.startsAt,
  sessionEndsAt: sessions.endsAt,
  title: unconferenceNotes.title,
  sticky: unconferenceNotes.sticky,
  color: unconferenceNotes.color,
  x: unconferenceNotes.x,
  y: unconferenceNotes.y,
  authorUserId: unconferenceNotes.authorUserId,
  authorName,
  createdAt: unconferenceNotes.createdAt,
  updatedAt: unconferenceNotes.updatedAt,
};

type NoteRow = {
  id: string;
  locationId: string;
  boardDay: string;
  sessionId: string | null;
  sessionSlug: string | null;
  sessionTitle: string | null;
  sessionDescription: string | null;
  sessionStatus: "draft" | "published" | null;
  sessionStartsAt: Date | null;
  sessionEndsAt: Date | null;
  title: string | null;
  sticky: NoticeDoc;
  poster: NoticeDoc;
  color: NoteColor;
  x: number;
  y: number;
  authorUserId: string;
  authorName: string;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Whether a session poster has a session the board may show: published and
 * placed. One whose session is a draft, or has lost its time, stays in the
 * table but off every board.
 */
const shownPoster = (row: NoteRow) =>
  !row.sessionId ||
  (row.sessionStatus === "published" &&
    !!row.sessionStartsAt &&
    !!row.sessionEndsAt);

const toNote = (
  row: NoteRow,
  reactions: Reaction[],
  hosts: string[] = [],
): UnconferenceNote => ({
  id: row.id,
  locationId: row.locationId,
  // A session poster is on whichever day its session is, so moving the
  // session moves the poster with it.
  day:
    row.sessionId && row.sessionStartsAt
      ? pacificDayKey(row.sessionStartsAt.toISOString())
      : row.boardDay,
  session:
    row.sessionId &&
    row.sessionSlug &&
    row.sessionTitle &&
    row.sessionStartsAt &&
    row.sessionEndsAt
      ? {
          id: row.sessionId,
          slug: row.sessionSlug,
          title: row.sessionTitle,
          description: row.sessionDescription,
          startsAt: row.sessionStartsAt.toISOString(),
          endsAt: row.sessionEndsAt.toISOString(),
          hosts,
        }
      : null,
  title: row.title,
  sticky: row.sticky,
  poster: row.poster,
  color: row.color,
  x: row.x,
  y: row.y,
  author: { userId: row.authorUserId, name: row.authorName },
  reactions,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/** Each note's reaction chips, as `viewerId` sees them. */
async function reactionsFor(
  noteIds: readonly string[],
  viewerId: string | null,
): Promise<Map<string, Reaction[]>> {
  const out = new Map<string, Reaction[]>();
  if (noteIds.length === 0) return out;
  const rows = await getDb()
    .select({
      noteId: unconferenceNoteReactions.noteId,
      emoji: unconferenceNoteReactions.emoji,
      userId: unconferenceNoteReactions.userId,
      name: authorName,
      createdAt: unconferenceNoteReactions.createdAt,
    })
    .from(unconferenceNoteReactions)
    .innerJoin(user, eq(user.id, unconferenceNoteReactions.userId))
    .where(inArray(unconferenceNoteReactions.noteId, [...noteIds]));
  const byNote = new Map<string, typeof rows>();
  for (const r of rows) {
    byNote.set(r.noteId, [...(byNote.get(r.noteId) ?? []), r]);
  }
  for (const [id, list] of byNote) {
    out.set(id, summarizeReactions(list, viewerId));
  }
  return out;
}

/** Each session's host names, lead first, for the posters that name them. */
async function hostsFor(
  sessionIds: readonly string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (sessionIds.length === 0) return out;
  const rows = await getDb()
    .select({ sessionId: sessionHosts.sessionId, name: authorName })
    .from(sessionHosts)
    .innerJoin(user, eq(user.id, sessionHosts.userId))
    .where(inArray(sessionHosts.sessionId, [...sessionIds]))
    .orderBy(asc(sessionHosts.position));
  for (const r of rows) {
    out.set(r.sessionId, [...(out.get(r.sessionId) ?? []), r.name]);
  }
  return out;
}

/** Rows to notes, with their reactions and their sessions' hosts. */
async function hydrate(
  rows: NoteRow[],
  viewerId: string | null,
): Promise<UnconferenceNote[]> {
  const [reactions, hosts] = await Promise.all([
    reactionsFor(
      rows.map((r) => r.id),
      viewerId,
    ),
    hostsFor(rows.flatMap((r) => (r.sessionId ? [r.sessionId] : []))),
  ]);
  return rows.map((r) =>
    toNote(
      r,
      reactions.get(r.id) ?? [],
      r.sessionId ? (hosts.get(r.sessionId) ?? []) : [],
    ),
  );
}

// All the board's listing wants of a plain notice's poster is its text, for
// the list view's line (see boardNote), and pen strokes are nearly all of its
// bytes. A session poster is drawn on the board, so it comes whole.
export const listedPoster = sql<NoticeDoc>`case
  when ${unconferenceNotes.sessionId} is not null then ${unconferenceNotes.poster}
  else jsonb_set(
    ${unconferenceNotes.poster},
    '{items}',
    jsonb_path_query_array(${unconferenceNotes.poster}, '$.items[*] ? (@.kind == "text")')
  )
end`;

const selectNotes = (
  poster: SQL<NoticeDoc> = sql`${unconferenceNotes.poster}`,
) =>
  getDb()
    .select({ ...noteColumns, poster })
    .from(unconferenceNotes)
    .innerJoin(user, eq(user.id, unconferenceNotes.authorUserId))
    .leftJoin(sessions, eq(sessions.id, unconferenceNotes.sessionId));

/**
 * Every note in these rooms, oldest first. The board restacks for painting.
 * A plain notice's poster comes without its strokes; noteById has it whole.
 */
export async function listNotesIn(
  locationIds: readonly string[],
  viewerId: string | null,
): Promise<UnconferenceNote[]> {
  if (locationIds.length === 0) return [];
  const rows = await selectNotes(listedPoster)
    .where(inArray(unconferenceNotes.locationId, [...locationIds]))
    .orderBy(asc(unconferenceNotes.createdAt), asc(unconferenceNotes.id));
  return hydrate(rows.filter(shownPoster), viewerId);
}

/**
 * One note as it stands. A partial edit (just the sticky, just the colour)
 * reads this rather than trusting the client for the other half.
 */
export async function noteById(
  noteId: string,
  viewerId: string | null = null,
): Promise<UnconferenceNote | null> {
  const [row] = await selectNotes()
    .where(eq(unconferenceNotes.id, noteId))
    .limit(1);
  if (!row) return null;
  const [note] = await hydrate([row], viewerId);
  return note ?? null;
}

export type NewNote = NoteFields & {
  locationId: string;
  day: string;
  authorUserId: string;
  x: number;
  y: number;
};

export async function createNote(note: NewNote): Promise<UnconferenceNote> {
  const { x, y } = clampNotePosition(note.x, note.y);
  const [row] = await getDb()
    .insert(unconferenceNotes)
    .values({
      locationId: note.locationId,
      boardDay: note.day,
      authorUserId: note.authorUserId,
      title: note.title,
      sticky: note.sticky,
      poster: note.poster,
      color: note.color,
      x,
      y,
    })
    .returning({ id: unconferenceNotes.id });
  const created = row && (await noteById(row.id, note.authorUserId));
  if (!created) throw new Error("That note could not be pinned up.");
  return created;
}

/**
 * Pins a session poster up on the board in `locationId`. One per session:
 * a second for the same session is refused by the column's unique key.
 */
export async function createSessionPoster(poster: {
  locationId: string;
  sessionId: string;
  day: string;
  authorUserId: string;
  title: string;
}): Promise<UnconferenceNote> {
  const [row] = await getDb()
    .insert(unconferenceNotes)
    .values({
      locationId: poster.locationId,
      sessionId: poster.sessionId,
      boardDay: poster.day,
      authorUserId: poster.authorUserId,
      title: poster.title.slice(0, 120),
      color: "butter",
    })
    .returning({ id: unconferenceNotes.id });
  const created = row && (await noteById(row.id, poster.authorUserId));
  if (!created) throw new Error("That poster could not be pinned up.");
  return created;
}

/**
 * What the author may rewrite. Names the documents, title and colour only,
 * so nothing built from a form can move a note to another room or hand it to
 * someone else.
 */
export async function updateNote(
  noteId: string,
  fields: NoteFields,
): Promise<void> {
  const [updated] = await getDb()
    .update(unconferenceNotes)
    .set({
      title: fields.title,
      sticky: fields.sticky,
      poster: fields.poster,
      color: fields.color,
    })
    .where(eq(unconferenceNotes.id, noteId))
    .returning({ id: unconferenceNotes.id });
  if (!updated) throw new Error("That note is no longer on the board.");
}

/**
 * A session poster's design and the session it stands for. Re-linking moves
 * it to the new session's day; the unique key refuses a session that
 * already has a poster.
 */
export async function updateSessionPoster(
  noteId: string,
  fields: { poster: NoticeDoc; sessionId: string; day: string; title: string },
): Promise<void> {
  const [updated] = await getDb()
    .update(unconferenceNotes)
    .set({
      poster: fields.poster,
      sessionId: fields.sessionId,
      boardDay: fields.day,
      title: fields.title.slice(0, 120),
    })
    .where(eq(unconferenceNotes.id, noteId))
    .returning({ id: unconferenceNotes.id });
  if (!updated) throw new Error("That poster is no longer on the board.");
}

/** Position only, clamped: the board's check constraints refuse the rest. */
export async function moveNote(
  noteId: string,
  position: { x: number; y: number },
): Promise<{ x: number; y: number }> {
  const { x, y } = clampNotePosition(position.x, position.y);
  const [updated] = await getDb()
    .update(unconferenceNotes)
    .set({ x, y })
    .where(eq(unconferenceNotes.id, noteId))
    .returning({ id: unconferenceNotes.id });
  if (!updated) throw new Error("That note is no longer on the board.");
  return { x, y };
}

/** True when a note was there to take down. */
export async function deleteNote(noteId: string): Promise<boolean> {
  const [gone] = await getDb()
    .delete(unconferenceNotes)
    .where(eq(unconferenceNotes.id, noteId))
    .returning({ id: unconferenceNotes.id });
  return gone !== undefined;
}

export async function noteAuthorId(noteId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ authorUserId: unconferenceNotes.authorUserId })
    .from(unconferenceNotes)
    .where(eq(unconferenceNotes.id, noteId))
    .limit(1);
  return row?.authorUserId ?? null;
}

/** How this request may change `noteId`, or null. See noteEditor(). */
export async function noteAccess(noteId: string): Promise<NoteEditor | null> {
  const [session, team, authorId] = await Promise.all([
    currentSession(),
    can("schedule.manage"),
    noteAuthorId(noteId),
  ]);
  if (!authorId) return null;
  return noteEditor(session?.user.id ?? null, authorId, !!team);
}

/** Everyone who reacted, per emoji, in the order the emoji first appeared. */
export async function reactorsOf(
  noteId: string,
): Promise<{ emoji: string; names: string[] }[]> {
  const rows = await getDb()
    .select({ emoji: unconferenceNoteReactions.emoji, name: authorName })
    .from(unconferenceNoteReactions)
    .innerJoin(user, eq(user.id, unconferenceNoteReactions.userId))
    .where(eq(unconferenceNoteReactions.noteId, noteId))
    .orderBy(asc(unconferenceNoteReactions.createdAt));
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.emoji, [...(out.get(r.emoji) ?? []), r.name]);
  return [...out].map(([emoji, names]) => ({ emoji, names }));
}

/** How many different emoji a notice already carries. */
export async function distinctEmojiCount(noteId: string): Promise<number> {
  const [row] = await getDb()
    .select({
      n: sql<number>`count(distinct ${unconferenceNoteReactions.emoji})::int`,
    })
    .from(unconferenceNoteReactions)
    .where(eq(unconferenceNoteReactions.noteId, noteId));
  return row?.n ?? 0;
}

/**
 * Adds the viewer's emoji, or takes it back off if it was already there.
 * Returns the note's chips afterwards.
 */
export async function toggleReaction(
  noteId: string,
  userId: string,
  emoji: string,
): Promise<{ added: boolean; reactions: Reaction[] }> {
  const db = getDb();
  const key = and(
    eq(unconferenceNoteReactions.noteId, noteId),
    eq(unconferenceNoteReactions.userId, userId),
    eq(unconferenceNoteReactions.emoji, emoji),
  );
  const removed = await db
    .delete(unconferenceNoteReactions)
    .where(key)
    .returning({ emoji: unconferenceNoteReactions.emoji });
  if (removed.length === 0) {
    await db
      .insert(unconferenceNoteReactions)
      .values({ noteId, userId, emoji })
      .onConflictDoNothing();
  }
  const chips = await reactionsFor([noteId], userId);
  return { added: removed.length === 0, reactions: chips.get(noteId) ?? [] };
}

// The posting budget is spent on pinning a note up, not on leaving it up:
// counting live rows would hand it back for every note the author deleted.
// Kept in Better Auth's verification table, like claimTicket's failure cap.
const postLog = (authorUserId: string) => `note-pinned:${authorUserId}`;

/** How many notes this account has pinned up inside the rate-limit window. */
export async function recentNoteCount(
  authorUserId: string,
  now = new Date(),
): Promise<number> {
  const db = getDb();
  const identifier = postLog(authorUserId);
  await db
    .delete(verification)
    .where(
      and(
        eq(verification.identifier, identifier),
        lte(verification.expiresAt, now),
      ),
    );
  const [row] = await db
    .select({ n: count() })
    .from(verification)
    .where(eq(verification.identifier, identifier));
  return row?.n ?? 0;
}

/** Spends one of this account's posts, whatever becomes of the note. */
export async function recordNotePost(
  authorUserId: string,
  now = new Date(),
): Promise<void> {
  await getDb()
    .insert(verification)
    .values({
      id: crypto.randomUUID(),
      identifier: postLog(authorUserId),
      value: "pinned",
      expiresAt: noteRateWindowExpiry(now),
    });
}
