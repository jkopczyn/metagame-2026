"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useOptimistic,
  useState,
  useTransition,
} from "react";
import RfpPanel from "@/app/backstage/schedule/RfpPanel";
import ScheduleGrid, {
  GrabHandle,
  type DropFn,
} from "@/app/backstage/schedule/ScheduleGrid";
import { smallButtonClass } from "@/app/backstage/ui";
import {
  buildDays,
  formatPacificDay,
  formatPacificTime,
  hostNames,
  isPlaced,
  movedTimes,
  type Category,
  type ScheduleLocation,
  type ScheduleSession,
} from "@/lib/schedule";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/v2/components/ui/dialog";
import {
  moveScheduled,
  scheduleProposal,
  unschedule,
  type Result,
} from "./actions";
import {
  SubmissionGroup,
  type Row,
  type SortState,
  type TableMeta,
} from "./SubmissionTable";

/** A listed proposal, with what the grid needs to book it. */
export type QueueRow = Row & { minutes: number; category: Category | null };
export type Group = { title: string; rows: QueueRow[] };

/** Queue rows ride the grid as stand-in sessions under this id. */
const queueId = (sessionId: string) => `rfp:${sessionId}`;
/** The session behind a grid session or a queue stand-in. */
const sessionIdOf = (s: ScheduleSession) =>
  s.id.startsWith("rfp:") ? s.id.slice(4) : s.id;

function asSession(row: QueueRow): ScheduleSession {
  return {
    id: queueId(row.id),
    slug: "",
    title: row.title,
    description: null,
    category: row.category,
    startsAt: null,
    endsAt: null,
    locationId: null,
    maxCapacity: null,
    minCapacity: null,
    ages: null,
    needs: null,
    status: "draft",
    rsvpIsCommitment: false,
    sponsored: false,
    airtableRfpRecordId: null,
    hosts: row.host ? [{ userId: "", name: row.host, email: "" }] : [],
    shepherd: null,
  };
}

type Change =
  | {
      kind: "place";
      session: ScheduleSession;
      startsAt: string;
      endsAt: string;
      locationId: string | null;
    }
  | { kind: "unplace"; session: ScheduleSession };

type Board = { sessions: ScheduleSession[]; groups: Group[] };

const markPlaced = (groups: Group[], sessionId: string, placed: boolean) =>
  groups.map((g) => ({
    ...g,
    rows: g.rows.map((r) => (r.id === sessionId ? { ...r, placed } : r)),
  }));

export default function ScheduleBoard({
  sessions: savedSessions,
  groups: savedGroups,
  locations,
  going,
  proposals,
  mutedIds,
  state,
  meta,
  split,
  children,
}: {
  sessions: ScheduleSession[];
  /** The tab's rows, each with a grip for the grid. */
  groups: Group[];
  locations: ScheduleLocation[];
  going: Record<string, number>;
  /** Every proposal by session id, for the details of what's on the grid. */
  proposals: Record<string, Row>;
  /** Sessions shown greyed: someone else's, in "assigned to me". */
  mutedIds: string[];
  state: SortState;
  meta: TableMeta;
  /** Grid in its own column beside the list, on screens with the room. */
  split?: boolean;
  /** Above the groups: the search box, or the empty-tab note. */
  children?: React.ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // Picked up by its grip; stays held across scrolling and day tabs until dropped.
  const [heldId, setHeldId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  // Drops show at once; a failed save snaps back when the transition ends.
  const [board, apply] = useOptimistic<Board, Change>(
    { sessions: savedSessions, groups: savedGroups },
    (b, change) => {
      const sessionId = sessionIdOf(change.session);
      if (change.kind === "place") {
        const { startsAt, endsAt, locationId } = change;
        const placed = { ...change.session, startsAt, endsAt, locationId };
        const known = b.sessions.some((s) => s.id === placed.id);
        return {
          sessions: known
            ? b.sessions.map((s) => (s.id === placed.id ? placed : s))
            : [...b.sessions, placed],
          groups: markPlaced(b.groups, sessionId, true),
        };
      }
      const s = change.session;
      return {
        sessions: b.sessions.map((x) =>
          x.id === s.id ? { ...x, startsAt: null, endsAt: null } : x,
        ),
        groups: markPlaced(b.groups, sessionId, false),
      };
    },
  );

  const rows = useMemo(
    () => board.groups.flatMap((g) => g.rows),
    [board.groups],
  );
  // Unplaced rows ride the grid as stand-ins; placed ones are their grid session.
  const queueSessions = useMemo(
    () =>
      new Map(
        rows.filter((r) => !r.placed).map((r) => [queueId(r.id), asSession(r)]),
      ),
    [rows],
  );
  const handleSession = (r: { id: string }) =>
    board.sessions.find((s) => sessionIdOf(s) === r.id && isPlaced(s)) ??
    queueSessions.get(queueId(r.id))!;
  const days = useMemo(() => buildDays(board.sessions), [board.sessions]);
  const muted = useMemo(() => new Set(mutedIds), [mutedIds]);

  const carrying = heldId
    ? (queueSessions.get(heldId) ??
      board.sessions.find((s) => s.id === heldId && isPlaced(s)) ??
      null)
    : null;
  const carriedRow = heldId?.startsWith("rfp:")
    ? rows.find((r) => queueId(r.id) === heldId)
    : undefined;
  // Only proposals go back to the list; hand-made sessions stay in /backstage/schedule.
  const canUnschedule =
    carrying !== null && !carriedRow && carrying.id in proposals;

  // Holding something: the cursor says so everywhere, and Esc lets go.
  useEffect(() => {
    if (!heldId) return;
    document.body.classList.add("cursor-grabbing");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHeldId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("cursor-grabbing");
      window.removeEventListener("keydown", onKey);
    };
  }, [heldId]);

  const run = (change: Change, action: () => Promise<Result>) =>
    startTransition(async () => {
      apply(change);
      setError((await action()).error ?? null);
    });

  const grab = (s: ScheduleSession) =>
    setHeldId((id) => (id === s.id ? null : s.id));

  const drop: DropFn = (start, locationId) => {
    if (!carrying) return;
    setHeldId(null);
    const times = carriedRow
      ? {
          startsAt: start,
          endsAt: new Date(start.getTime() + carriedRow.minutes * 60_000),
        }
      : movedTimes(carrying, start);
    const change: Change = {
      kind: "place",
      session: carrying,
      startsAt: times.startsAt.toISOString(),
      endsAt: times.endsAt.toISOString(),
      locationId,
    };
    run(change, () =>
      carriedRow
        ? scheduleProposal(carriedRow.id, start.toISOString(), locationId)
        : moveScheduled(carrying.id, start.toISOString(), locationId),
    );
  };

  const takeOff = (s: ScheduleSession) => {
    setHeldId(null);
    setOpenId(null);
    run({ kind: "unplace", session: s }, () => unschedule(s.id));
  };

  const open = openId ? board.sessions.find((s) => s.id === openId) : null;
  const openRow = open ? proposals[sessionIdOf(open)] : undefined;
  const roomName = (id: string | null) =>
    locations.find((l) => l.id === id)?.name ?? "No room";

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-meeple">{error}</p>}

      <div className={split ? "md:flex md:items-start md:gap-6" : "space-y-6"}>
        <div className={`space-y-6 ${split ? "min-w-0 md:flex-1" : ""}`}>
          {children}
          {rows.length > 0 && (
            <div
              onDragOver={(e) => {
                if (canUnschedule) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (canUnschedule && carrying) takeOff(carrying);
              }}
              className={`rounded-xl transition-colors ${
                canUnschedule
                  ? "outline-2 outline-offset-4 outline-navy/40 outline-dashed"
                  : ""
              }`}
            >
              {canUnschedule && carrying && (
                <button
                  type="button"
                  onClick={() => takeOff(carrying)}
                  className="mb-3 w-full rounded-lg border border-dashed border-navy/40 bg-navy/[0.04] px-4 py-3 text-sm text-navy hover:bg-navy/[0.08]"
                >
                  Drop here to take <strong>{carrying.title}</strong> off the
                  schedule
                </button>
              )}
              <div className="space-y-6">
                {board.groups.map((g) => (
                  <SubmissionGroup
                    key={g.title}
                    title={g.title}
                    rows={g.rows}
                    state={state}
                    meta={meta}
                    rowClass={(r) =>
                      heldId === handleSession(r).id ? "bg-navy/[0.06]" : ""
                    }
                    lead={(r) => {
                      const session = handleSession(r);
                      return (
                        <GrabHandle
                          session={session}
                          carrying={heldId === session.id}
                          onGrab={grab}
                          className={`h-7 w-6 ${r.placed ? "text-navy" : ""}`}
                        />
                      );
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <section
          className={`space-y-3 ${
            split
              ? `mt-6 md:sticky md:top-20 md:mt-0 md:w-1/2 md:shrink-0 ${children ? "hidden md:block" : ""}`
              : ""
          }`}
        >
          <h2 className="font-bebas text-lg tracking-wide text-navy">
            On the schedule
          </h2>
          <ScheduleGrid
            days={days}
            locations={locations}
            going={going}
            carrying={carrying}
            carryMinutes={carriedRow?.minutes}
            muted={(s) => muted.has(s.id)}
            onOpen={(s) => setOpenId(s.id)}
            onGrab={grab}
            onDrop={drop}
          />
        </section>
      </div>

      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpenId(null)}>
          <DialogContent className="max-h-[92vh] max-w-[560px] overflow-y-auto border-line bg-white px-6 py-6 text-ink">
            <DialogTitle className="font-bebas pr-6 text-2xl tracking-wide text-navy">
              {open.title}
            </DialogTitle>
            <DialogDescription className="text-sm text-ink/65">
              {isPlaced(open)
                ? `${formatPacificDay(open.startsAt)} ${formatPacificTime(open.startsAt)}–${formatPacificTime(open.endsAt)} · ${roomName(open.locationId)}`
                : "Not placed"}
              {open.hosts.length > 0 && ` · ${hostNames(open)}`}
              {open.status === "draft" && " · Draft"}
            </DialogDescription>

            {openRow && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                {(
                  [
                    ["Host", openRow.host],
                    ["Grader", openRow.grader],
                    ["Verdict", openRow.verdict],
                    ["Shepherd", openRow.shepherd],
                    ["Next steps", openRow.nextSteps],
                    ["Speaker tier", openRow.speakerTier],
                    ["Megagame", openRow.megagameIntegration],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="text-ink/50">{label}</dt>
                    <dd className="text-ink/85">{value || "—"}</dd>
                  </div>
                ))}
              </dl>
            )}
            <RfpPanel
              sessionId={sessionIdOf(open)}
              recordId={open.airtableRfpRecordId}
              shepherd={open.shepherd}
            />

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <Link href="/backstage/schedule" className={smallButtonClass}>
                Edit in /backstage/schedule
              </Link>
              {openRow && isPlaced(open) && (
                <button
                  type="button"
                  onClick={() => takeOff(open)}
                  className="rounded-md bg-meeple px-3 py-1 text-sm font-semibold text-white hover:bg-meeple-dark"
                >
                  Remove from schedule
                </button>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
