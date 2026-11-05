"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  noteReactors,
  openNote as fetchNote,
  pinNote,
  pinSessionPoster,
  reactToNote,
  repinNote,
  saveNote,
  saveSessionPoster,
  unpinNote,
  type NoteState,
} from "@/app/(v2)/schedule/note-actions";
import {
  boardEditor,
  canDeleteNote,
  canEditNote,
  canMoveNote,
  pickNoteColor,
  type BoardData,
  type BoardNote,
  type NoteColor,
  type Reaction,
} from "@/lib/unconference";
import type { NoticeDoc } from "@/lib/notice-doc";
import NoticeDialog, { type Draft } from "./notice/NoticeDialog";

// Every note surface — the board column in grid view and the rows in list
// view — reads its notes from here, so switching view or day tab doesn't
// throw away a note that was just pinned up. The actions deliberately skip
// revalidatePath, so this state is the only thing that moves until the next
// server render.

type Spot = { x: number; y: number };

export type NoteBoard = {
  /** Whether there is an account, so a surface says which key is missing. */
  signedIn: boolean;
  canPost: boolean;
  isTeam: boolean;
  /** The static home page's copy: look, don't touch. */
  readOnly: boolean;
  notesIn: (locationId: string, day: string) => BoardNote[];
  /** Adds or takes back the viewer's emoji; shown at once, then saved. */
  react: (noteId: string, emoji: string) => void;
  /** The team pins a session's poster up on its day's board. */
  pinSession: (locationId: string, sessionId: string) => Promise<NoteState>;
  /** Takes a notice down; for a session poster, which opens no dialog. */
  takeDown: (noteId: string) => Promise<NoteState>;
  /** The team saves a session poster's design and the session it links to. */
  saveSessionPoster: (
    noteId: string,
    input: { poster: NoticeDoc; sessionId: string },
  ) => Promise<NoteState>;
  /** Whether this viewer may drag a note around, by the server's own rule. */
  canMove: (note: BoardNote) => boolean;
  open: (noteId: string) => void;
  compose: (locationId: string, day: string, spot: Spot) => void;
  /** Where a drag let go of a note: shown at once, then saved. */
  commit: (noteId: string, x: number, y: number) => void;
};

const Context = createContext<NoteBoard | null>(null);

export function useNoteBoard(): NoteBoard {
  const board = useContext(Context);
  if (!board) throw new Error("Note surfaces must be inside <BoardNotes>.");
  return board;
}

/** Shown when the viewer holds no ticket, so the board is read-only. */
export const NEEDS_TICKET_HINT = "A claimed ticket is needed to pin a note up.";

const FAILED = "Couldn’t save. Try again.";

let inFlight = 0;
let started = 0;

/** A new server read would undo the optimistic state of any of these. */
export const noteWritesInFlight = () => inFlight;
export const noteWritesStarted = () => started;

const safely = async (run: () => Promise<NoteState>): Promise<NoteState> => {
  inFlight += 1;
  started += 1;
  try {
    return await run();
  } catch {
    return { error: FAILED };
  } finally {
    inFlight -= 1;
  }
};

const withNote = (list: BoardNote[], note: BoardNote) =>
  list.some((n) => n.id === note.id)
    ? list.map((n) => (n.id === note.id ? note : n))
    : [...list, note];

const moved = (list: BoardNote[], id: string, at: Spot) =>
  list.map((n) => (n.id === id ? { ...n, ...at } : n));

const without = (list: BoardNote[], id: string) =>
  list.filter((n) => n.id !== id);

const withReactions = (list: BoardNote[], id: string, reactions: Reaction[]) =>
  list.map((n) => (n.id === id ? { ...n, reactions } : n));

/** The chips after the viewer taps `emoji`, before the server answers. */
function toggled(reactions: Reaction[], emoji: string): Reaction[] {
  const chip = reactions.find((r) => r.emoji === emoji);
  if (!chip) {
    return [...reactions, { emoji, count: 1, mine: true, names: ["You"] }];
  }
  const count = chip.count + (chip.mine ? -1 : 1);
  if (count <= 0) return reactions.filter((r) => r.emoji !== emoji);
  return reactions.map((r) =>
    r.emoji === emoji ? { ...r, count, mine: !r.mine } : r,
  );
}

type Pending =
  // The colour is drawn when the composer opens, not when the note saves, so
  // the dialog can wear the paper it is about to become. `createdId` is set
  // by the first save, so the same dialog keeps editing that notice.
  | {
      kind: "new";
      locationId: string;
      day: string;
      spot: Spot;
      color: NoteColor;
      createdId?: string;
    }
  | { kind: "open"; noteId: string }
  | null;

export default function BoardNotes({
  board,
  children,
}: {
  board: BoardData;
  children: ReactNode;
}) {
  // `confirmed` is the server's last answer, for rolling back a failed write.
  const [state, setState] = useState({
    shown: board.notes,
    confirmed: board.notes,
    props: board.notes,
  });
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  // Drops land in order but an earlier answer can resolve after a later one,
  // so each note's sequence decides which answer may still be applied.
  const latest = useRef(new Map<string, number>());
  const shown = state.shown;

  // A fresh server render wins: it is the only thing that can know about a
  // note somebody else pinned up.
  if (state.props !== board.notes) {
    // The listing carries no posters, so one already fetched is kept while
    // the note is otherwise unchanged; an edit by someone else (a newer
    // updatedAt) drops it, and the open dialog fetches the new one.
    const notes = board.notes.map((n) => {
      if (n.poster) return n;
      const had = state.shown.find((o) => o.id === n.id);
      return had?.poster && had.updatedAt === n.updatedAt
        ? { ...n, poster: had.poster }
        : n;
    });
    setState({ shown: notes, confirmed: notes, props: board.notes });
  }

  const notesIn = useCallback(
    (locationId: string, day: string) =>
      shown.filter((n) => n.locationId === locationId && n.day === day),
    [shown],
  );

  const editorOf = (note: BoardNote) => boardEditor(note, board);

  const adopt = useCallback(
    (note: BoardNote) =>
      setState((s) => ({
        ...s,
        shown: withNote(s.shown, note),
        confirmed: withNote(s.confirmed, note),
      })),
    [],
  );

  const commit = useCallback(async (noteId: string, x: number, y: number) => {
    const seq = (latest.current.get(noteId) ?? 0) + 1;
    latest.current.set(noteId, seq);
    setError(null);
    setState((s) => ({ ...s, shown: moved(s.shown, noteId, { x, y }) }));
    const result = await safely(() => repinNote(noteId, x, y));
    const isLatest = latest.current.get(noteId) === seq;
    if (result.error || !result.position) {
      if (!isLatest) return;
      setState((s) => {
        const was = s.confirmed.find((n) => n.id === noteId);
        return was ? { ...s, shown: moved(s.shown, noteId, was) } : s;
      });
      setError(result.error ?? FAILED);
      return;
    }
    const at = result.position;
    setState((s) => ({
      ...s,
      confirmed: moved(s.confirmed, noteId, at),
      shown: isLatest ? moved(s.shown, noteId, at) : s.shown,
    }));
  }, []);

  async function save(draft: Draft, id: string | null): Promise<NoteState> {
    setError(null);
    if (!id) {
      // No id means the first save of a notice being composed, which only
      // ever happens under a "new" pending.
      if (pending?.kind !== "new") return { error: "That note is gone." };
      const { locationId, day, spot } = pending;
      const result = await safely(() =>
        pinNote(locationId, day, { ...draft, ...spot }),
      );
      if (result.note) {
        adopt(result.note);
        const createdId = result.note.id;
        setPending((p) => (p?.kind === "new" ? { ...p, createdId } : p));
      }
      return result;
    }
    const result = await safely(() => saveNote(id, draft));
    if (result.note) adopt(result.note);
    return result;
  }

  async function react(noteId: string, emoji: string) {
    setError(null);
    setState((s) => {
      const note = s.shown.find((n) => n.id === noteId);
      return note
        ? {
            ...s,
            shown: withReactions(
              s.shown,
              noteId,
              toggled(note.reactions, emoji),
            ),
          }
        : s;
    });
    const result = await safely(() => reactToNote(noteId, emoji));
    if (result.reactions) {
      const reactions = result.reactions;
      setState((s) => ({
        ...s,
        shown: withReactions(s.shown, noteId, reactions),
        confirmed: withReactions(s.confirmed, noteId, reactions),
      }));
      return;
    }
    setState((s) => {
      const was = s.confirmed.find((n) => n.id === noteId);
      return was
        ? { ...s, shown: withReactions(s.shown, noteId, was.reactions) }
        : s;
    });
    setError(result.error ?? FAILED);
  }

  async function pinSession(
    locationId: string,
    sessionId: string,
  ): Promise<NoteState> {
    setError(null);
    const result = await safely(() => pinSessionPoster(locationId, sessionId));
    if (result.note) adopt(result.note);
    else setError(result.error ?? FAILED);
    return result;
  }

  async function savePoster(
    noteId: string,
    input: { poster: NoticeDoc; sessionId: string },
  ): Promise<NoteState> {
    const result = await safely(() => saveSessionPoster(noteId, input));
    if (result.note) adopt(result.note);
    return result;
  }

  async function remove(noteId: string) {
    setError(null);
    setState((s) => ({ ...s, shown: without(s.shown, noteId) }));
    const result = await safely(() => unpinNote(noteId));
    if (result.error) {
      setState((s) => {
        const was = s.confirmed.find((n) => n.id === noteId);
        return was ? { ...s, shown: withNote(s.shown, was) } : s;
      });
      // The dialog this is called from shows the error itself.
      return result;
    }
    setState((s) => ({ ...s, confirmed: without(s.confirmed, noteId) }));
    return result;
  }

  // A note that has gone (a delete, or a server render without it) leaves
  // nothing to draw; the stale `pending` is replaced by the next open.
  const openId =
    pending?.kind === "open"
      ? pending.noteId
      : pending?.kind === "new"
        ? pending.createdId
        : undefined;
  const openNote = openId ? (shown.find((n) => n.id === openId) ?? null) : null;

  const editor = openNote ? editorOf(openNote) : null;

  // The listing leaves posters out, and a fresh server render drops them
  // again, so the open notice's poster is fetched whenever it is missing.
  const fetching = useRef<string | null>(null);
  useEffect(() => {
    if (!openNote || openNote.poster || fetching.current === openNote.id) {
      return;
    }
    const id = openNote.id;
    fetching.current = id;
    void (async () => {
      const result = await safely(() => fetchNote(id));
      fetching.current = null;
      if (result.note) adopt(result.note);
      else setError(result.error ?? FAILED);
    })();
  }, [openNote, adopt]);

  // What to do instead of reacting, for a viewer who can't.
  const reactHint =
    board.canPost || board.readOnly ? null : board.signedIn ? (
      <Link
        href="/account?tab=tickets"
        className="underline underline-offset-2"
      >
        Claim your ticket to react
      </Link>
    ) : (
      <Link
        href="/login?next=%2Fschedule"
        className="underline underline-offset-2"
      >
        Sign in to react
      </Link>
    );

  return (
    <Context.Provider
      value={{
        signedIn: board.signedIn,
        canPost: board.canPost,
        isTeam: board.isTeam,
        readOnly: !!board.readOnly,
        notesIn,
        react: (noteId, emoji) => void react(noteId, emoji),
        pinSession,
        takeDown: remove,
        saveSessionPoster: savePoster,
        // canPost as well as authorship: every write re-checks the permission,
        // so an author who has lost it is offered no drag it can only refuse.
        canMove: (note) => board.canPost && canMoveNote(editorOf(note)),
        open: (noteId) => setPending({ kind: "open", noteId }),
        // The paper cycles through the pad as that board fills up, so
        // neighbours tend to differ; the author can repaint it anyway.
        compose: (locationId, day, spot) =>
          setPending({
            kind: "new",
            locationId,
            day,
            spot,
            color: pickNoteColor(notesIn(locationId, day).length),
          }),
        commit,
      }}
    >
      {children}
      {/* Not beside the notes: a board column is a whole day tall, so a drag
          that failed near the bottom of it would report that hundreds of
          pixels above the viewport. */}
      {error && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-[60] flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-lg border border-cream/20 bg-navy px-4 py-2 text-sm text-cream shadow-lg"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 text-cream/55 underline underline-offset-4 hover:text-cream"
          >
            Dismiss
          </button>
        </div>
      )}
      {pending && (openNote || pending.kind === "new") && (
        <NoticeDialog
          key={pending.kind === "open" ? pending.noteId : "new"}
          note={openNote}
          draftColor={pending.kind === "new" ? pending.color : undefined}
          canEdit={
            board.canPost && (pending.kind === "new" || canEditNote(editor))
          }
          // Delete is not gated on canPost: a team member clearing the board
          // holds no ticket, and the action allows them without one.
          canDelete={!!openNote && canDeleteNote(editor)}
          canReact={board.canPost}
          reactHint={reactHint}
          onClose={() => setPending(null)}
          onSave={save}
          onDelete={remove}
          onReact={(id, emoji) => void react(id, emoji)}
          loadReactors={noteReactors}
        />
      )}
    </Context.Provider>
  );
}
