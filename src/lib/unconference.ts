// The unconference bulletin board's plain data and rules. No database and no
// React imports, so the board component, the server actions and the store all
// read the same constants. Positions are fractions of the board, never pixels:
// the column is 1fr-fluid and its height changes with the day.

import { noticeText, type NoticeDoc } from "./notice-doc";

/** Mirrors the unconference_note_color pgEnum. */
export const NOTE_COLORS = [
  "butter",
  "rose",
  "sky",
  "mint",
  "tangerine",
  "lilac",
] as const;

export type NoteColor = (typeof NOTE_COLORS)[number];

export const isNoteColor = (value: unknown): value is NoteColor =>
  typeof value === "string" &&
  (NOTE_COLORS as readonly string[]).includes(value);

/** One emoji on one notice, as the board shows it. */
export type Reaction = {
  emoji: string;
  count: number;
  /** Whether the viewer is one of them, so the chip shows pressed. */
  mine: boolean;
  /** A few of the names, for the chip's tooltip. */
  names: string[];
};

/** The session a session poster stands for, as the board draws it. */
export type PosterSession = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  /** ISO. */
  startsAt: string;
  endsAt: string;
  hosts: string[];
};

/**
 * A notice: a sticky note, which is what the board draws, and the poster it
 * opens into. Both are NoticeDocs; see notice-doc.ts. A session poster
 * (`session` set) is the team's instead: drawn full width at the session's
 * own time, over every sticky, and it opens the session.
 */
export type UnconferenceNote = {
  id: string;
  locationId: string;
  /** The Pacific day ("2026-11-07") whose board it is on. */
  day: string;
  /** Plain text standing in for the notice, derived on save; null if only drawings. */
  title: string | null;
  sticky: NoticeDoc;
  poster: NoticeDoc;
  /** The sticky note's paper. */
  color: NoteColor;
  /** Fractions of the board, 0..1, measured from its top left. */
  x: number;
  y: number;
  author: { userId: string; name: string };
  reactions: Reaction[];
  session: PosterSession | null;
  /** ISO strings. */
  createdAt: string;
  updatedAt: string;
};

/**
 * A note as the board's client is sent it: the author's name for the tile,
 * and whether it is the viewer's own, decided on the server. No account id:
 * tiles don't link to profiles.
 */
export type BoardNote = Omit<UnconferenceNote, "author" | "poster"> & {
  author: { name: string };
  mine: boolean;
  /**
   * The poster, or null when it hasn't been sent: the board's listing leaves
   * a plain notice's poster out (it is the bulk of the payload, and only
   * one is open at a time) and the dialog fetches it on opening. A session
   * poster's always comes along, since the board draws it.
   */
  poster: NoticeDoc | null;
  /** The poster's text in one line, for the list view. */
  summary: string;
};

export const boardNote = (
  note: UnconferenceNote,
  viewerId: string | null,
  { withPoster = true }: { withPoster?: boolean } = {},
): BoardNote => ({
  ...note,
  author: { name: note.author.name },
  mine: !!viewerId && note.author.userId === viewerId,
  poster: withPoster || note.session ? note.poster : null,
  summary: noticeText(note.poster),
});

/**
 * The columns a note's author may change. Separate from the row so no write
 * built from this can move a note between rooms or change its author.
 */
export type NoteFields = {
  title: string | null;
  sticky: NoticeDoc;
  poster: NoticeDoc;
  color: NoteColor;
};

/**
 * Everything the board's client needs that it can't work out for itself: the
 * notes for every board room on the page, and what this viewer may do. The
 * permissions are recomputed inside every server action; these only decide
 * which affordances are drawn.
 */
export type BoardData = {
  notes: BoardNote[];
  /** Whether there is an account at all, so the board says which key is missing. */
  signedIn: boolean;
  /** Holds unconference.post, which also covers reacting. */
  canPost: boolean;
  /** Holds schedule.manage, so may take anyone's note down. */
  isTeam: boolean;
  /**
   * A copy with no viewer behind it (the static home page): nothing can be
   * posted or reacted to there, and the board says to use /schedule.
   */
  readOnly?: boolean;
};

/**
 * A colour for a new note. Deterministic on purpose: a module every test
 * imports must not reach for Math.random, so the caller supplies the seed
 * (a count of existing notes, a random integer, whatever it has).
 */
export function pickNoteColor(index: number): NoteColor {
  if (!Number.isFinite(index)) return NOTE_COLORS[0];
  const i = Math.trunc(index) % NOTE_COLORS.length;
  return NOTE_COLORS[i < 0 ? i + NOTE_COLORS.length : i];
}

/** Mirrors the unconference_note_reactions_emoji_length check. */
export const EMOJI_MAX = 32;

/** How many different emoji one notice can collect. */
export const REACTIONS_PER_NOTE_MAX = 30;

// One emoji, possibly a ZWJ sequence with skin tones, a flag or a keycap:
// only emoji parts, and at least one part that is a picture on its own.
const EMOJI_PARTS =
  /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\p{Emoji_Modifier}|‍|️|⃣)+$/u;
const EMOJI_CORE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;

/** The emoji as it may be stored, or null. */
export function parseEmoji(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const emoji = value.trim();
  if (emoji.length === 0 || emoji.length > EMOJI_MAX) return null;
  if (!EMOJI_PARTS.test(emoji) || !EMOJI_CORE.test(emoji)) return null;
  return emoji;
}

/**
 * Reaction rows folded into chips, in the order each emoji first appeared,
 * the way Discord keeps them.
 */
export function summarizeReactions(
  rows: readonly {
    emoji: string;
    userId: string;
    name: string;
    createdAt: Date | string;
  }[],
  viewerId: string | null,
): Reaction[] {
  const sorted = [...rows].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const chips = new Map<string, Reaction>();
  for (const r of sorted) {
    const chip = chips.get(r.emoji) ?? {
      emoji: r.emoji,
      count: 0,
      mine: false,
      names: [],
    };
    chip.count += 1;
    if (viewerId && r.userId === viewerId) chip.mine = true;
    if (chip.names.length < 8) chip.names.push(r.name);
    chips.set(r.emoji, chip);
  }
  return [...chips.values()];
}

/** The tile's own size, as fractions of the board. */
export type TileSize = { width: number; height: number };

const NO_TILE: TileSize = { width: 0, height: 0 };

const clampFraction = (value: number, size: number): number => {
  if (!Number.isFinite(value)) return 0;
  // A tile wider than the board can only sit flush against the left edge.
  const max = Number.isFinite(size) ? Math.max(0, 1 - Math.max(0, size)) : 1;
  return Math.min(Math.max(value, 0), max);
};

/**
 * x and y pinned inside the board. The tile's size counts: a note is drawn
 * from its top left, so without it a note at x = 1 would hang off the edge.
 */
export function clampNotePosition(
  x: number,
  y: number,
  tile: TileSize = NO_TILE,
): { x: number; y: number } {
  return {
    x: clampFraction(x, tile.width),
    y: clampFraction(y, tile.height),
  };
}

type Pinned = { id: string; createdAt: string | Date };

const at = (value: string | Date): number =>
  (value instanceof Date ? value : new Date(value)).getTime();

/**
 * Notes back to front: the LAST one paints on top, so the NEWEST note sits on
 * top, like the last thing pinned to a real board.
 */
export function notesInPaintOrder<T extends Pinned>(notes: readonly T[]): T[] {
  return [...notes].sort((a, b) => {
    const diff = at(a.createdAt) - at(b.createdAt);
    // Same instant: fall back to the id so the stack never shuffles.
    return diff !== 0 ? diff : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Carries no account id, unlike SessionEditor: the board's client payload has
 * none to carry, and nothing reads an id back off a standing.
 */
export type NoteEditor = { via: "author" | "team" };

/**
 * Who this viewer is to the note, pure so it can be tested without a
 * database. Author wins over team: an author who is also on the team still
 * gets to edit their own note, which `via: "team"` would refuse.
 */
export function noteEditor(
  viewerId: string | null,
  authorId: string,
  isTeam: boolean,
): NoteEditor | null {
  if (!viewerId) return null;
  if (viewerId === authorId) return { via: "author" };
  return isTeam ? { via: "team" } : null;
}

/** The same rule on the client, where a note carries `mine` and no ids. */
export function boardEditor(
  note: { mine: boolean },
  viewer: { signedIn: boolean; isTeam: boolean },
): NoteEditor | null {
  if (!viewer.signedIn) return null;
  if (note.mine) return { via: "author" };
  return viewer.isTeam ? { via: "team" } : null;
}

/** Only the author rewrites or recolours a note. */
export const canEditNote = (editor: NoteEditor | null): boolean =>
  editor?.via === "author";

/** The author or the team takes one down. */
export const canDeleteNote = (editor: NoteEditor | null): boolean =>
  editor !== null;

/** Only the author moves their own note around the board. */
export const canMoveNote = canEditNote;

// Posting is open to every ticket holder, so one account can't paper the
// board faster than this. Enforced in the server action, not the database.
export const NOTE_RATE_LIMIT = 10;
export const NOTE_RATE_WINDOW_MS = 10 * 60 * 1000;

/** Whether `recent` notes in the window is already too many. */
export const overNoteRateLimit = (recent: number): boolean =>
  recent >= NOTE_RATE_LIMIT;

/** When a note pinned up at `now` stops counting towards the limit. */
export const noteRateWindowExpiry = (now: Date): Date =>
  new Date(now.getTime() + NOTE_RATE_WINDOW_MS);

/** How many tile-sized spots across and down a board of this size holds. */
export function boardLattice(
  width: number,
  height: number,
  tile: number,
): { columns: number; rows: number } {
  const across = (span: number) =>
    Number.isFinite(span) && tile > 0
      ? Math.max(1, Math.floor(span / tile))
      : 1;
  return { columns: across(width), rows: across(height) };
}

/** The board as the browser measured it, in pixels. */
export type BoardSize = { width: number; height: number; tile: number };

const EPSILON = 1e-9;

/**
 * Where a note goes when nobody dragged it anywhere: the first spot on a
 * tile-sized lattice whose tile would not overlap a note already up, read
 * left to right then top to bottom. Touch can't drag, so this is the only
 * placement a phone has — a spot that overlapped an older note would be
 * painted over by it and the new note left unreachable.
 */
export function firstFreeSpot(
  taken: readonly { x: number; y: number }[],
  board: BoardSize,
): { x: number; y: number } {
  const { columns, rows } = boardLattice(board.width, board.height, board.tile);
  const tile = Number.isFinite(board.tile) ? Math.max(0, board.tile) : 0;
  // A fraction spans the board minus one tile, so this is how far apart in
  // fractions two tiles have to be to miss each other.
  const clearance = (length: number) => {
    const span = Number.isFinite(length) ? Math.max(0, length - tile) : 0;
    return span > 0 ? Math.min(1, tile / span) : 1;
  };
  const clearX = clearance(board.width);
  const clearY = clearance(board.height);
  const fraction = (i: number, n: number) => (n > 1 ? i / (n - 1) : 0);
  // Tiles only overlap when they overlap on both axes.
  const free = (x: number, y: number) =>
    taken.every(
      (p) =>
        Math.abs(p.x - x) >= clearX - EPSILON ||
        Math.abs(p.y - y) >= clearY - EPSILON,
    );
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = fraction(column, columns);
      const y = fraction(row, rows);
      if (free(x, y)) return { x, y };
    }
  }
  // Nowhere free: fan the overflow into the gaps between the spots rather
  // than onto them, a smaller part of a step in on each wrap. A note placed
  // exactly on an older one is painted over by it — the oldest sits on top —
  // and on touch there is no drag to pull it back out.
  const gapsX = Math.max(1, columns - 1);
  const gapsY = Math.max(1, rows - 1);
  const step = (count: number) => (count > 1 ? 1 / (count - 1) : 1);
  const fanned = (i: number) => {
    const inset = 1 / (Math.floor(i / (gapsX * gapsY)) + 2);
    return {
      x: fraction(i % gapsX, columns) + step(columns) * inset,
      y: fraction(Math.floor(i / gapsX) % gapsY, rows) + step(rows) * inset,
    };
  };
  // Every i fans to a different point, so one of these lands on nothing.
  const n = Math.max(0, taken.length);
  for (let i = n; i <= n + taken.length; i++) {
    const spot = fanned(i);
    if (!taken.some((p) => p.x === spot.x && p.y === spot.y)) return spot;
  }
  return fanned(n);
}
