"use client";

import { useMemo, useState } from "react";
import { GripVerticalIcon } from "lucide-react";
import { FaListUl, FaThLarge } from "react-icons/fa";
import {
  cellSessions,
  capAtMidnight,
  findClash,
  formatPacificTime,
  fromPacificWall,
  heightPx,
  hostNames,
  laneInset,
  minutesToHHMM,
  movedTimes,
  offsetPx,
  outsideHours,
  overlapLanes,
  NO_ROOM,
  openingDayKey,
  selectedDay,
  slotLabel,
  SLOT_MINUTES,
  SLOT_PX,
  type Day,
  type Lane,
  type PlacedSession,
  type RoomClash,
  type ScheduleLocation,
  type ScheduleSession,
} from "@/lib/schedule";
import {
  AgeMark,
  BlockSummary,
  blockStyle,
} from "@/v2/components/schedule/SessionBits";
import { LEGEND } from "@/v2/lib/schedule-styles";
import type { SessionDefaults } from "./SessionForm";

type View = "grid" | "list";
type OpenFn = (s: ScheduleSession) => void;
type CreateFn = (defaults: SessionDefaults) => void;
type GrabFn = (s: ScheduleSession) => void;
/** Where a drop that ran past midnight was cut back to, and how long it was. */
export type MidnightCut = { endsAt: Date; fromMinutes: number };

/**
 * `clash` is what it would overlap and `cut` set when it was shortened to end
 * at midnight, both for a parent that confirms such drops.
 */
export type DropFn = (
  startsAt: Date,
  locationId: string | null,
  clash: RoomClash | null,
  cut: MidnightCut | null,
) => void;

/** The grip that picks a session up; the rest of the block still opens it. */
export function GrabHandle({
  session,
  carrying,
  onGrab,
  className = "",
}: {
  session: ScheduleSession;
  carrying: boolean;
  onGrab: GrabFn;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={`Move ${session.title}`}
      aria-pressed={carrying}
      title="Move: drag it to a slot, or click, then click a slot. Esc cancels."
      onClick={() => onGrab(session)}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", session.id);
        // Deferred: re-rendering the drag source inside dragstart cancels the drag in Chrome.
        if (!carrying) setTimeout(() => onGrab(session));
      }}
      // A drag let go anywhere but a slot drops the hold rather than leaving it held.
      onDragEnd={(e) => {
        if (e.dataTransfer.dropEffect === "none") onGrab(session);
      }}
      className={`flex cursor-grab items-center justify-center rounded text-[#1b1530]/45 transition-colors hover:bg-[#1b1530]/10 hover:text-[#1b1530] ${
        carrying ? "bg-[#1b1530]/10 text-[#1b1530]" : ""
      } ${className}`}
    >
      <GripVerticalIcon size={14} aria-hidden />
    </button>
  );
}

function SessionBlock({
  session,
  slotStart,
  lane,
  going,
  carrying,
  muted,
  onOpen,
  onGrab,
}: {
  session: PlacedSession;
  slotStart: number;
  lane: Lane | undefined;
  going: number;
  /** What's being moved, if anything; blocks let clicks through to the slots meanwhile. */
  carrying: ScheduleSession | null;
  /** Shown greyed for reference, with no grip. */
  muted: boolean;
  onOpen: OpenFn;
  onGrab: GrabFn;
}) {
  const draft = session.status === "draft";
  const isCarried = carrying?.id === session.id;
  return (
    <div
      style={{
        top: offsetPx(session, slotStart),
        height: heightPx(session),
        ...laneInset(lane),
        ...blockStyle(session),
      }}
      className={`absolute inset-x-0.5 z-10 overflow-hidden rounded-md border text-[#1b1530] transition-shadow hover:z-20 hover:shadow-[0_2px_10px_rgba(27,21,48,0.25)] ${
        draft ? "border-dashed" : ""
      } ${muted ? "opacity-35 grayscale" : draft ? "opacity-60" : ""} ${
        carrying ? "pointer-events-none" : ""
      } ${isCarried ? "opacity-30" : ""}`}
    >
      {!muted && (
        <GrabHandle
          session={session}
          carrying={isCarried}
          onGrab={onGrab}
          className="absolute top-0.5 right-0.5 z-10 h-5 w-4"
        />
      )}
      <button
        type="button"
        onClick={() => onOpen(session)}
        title={`${session.title}${session.hosts.length ? " — " + hostNames(session) : ""}${draft ? " (draft)" : ""}`}
        className="block h-full w-full p-1.5 pr-4 text-left"
      >
        <BlockSummary session={session} />
        {(going > 0 || session.maxCapacity !== null) && (
          <span className="mt-0.5 block text-[11px] leading-tight text-[#1b1530]/70">
            👤 {going}
            {session.maxCapacity !== null && `/${session.maxCapacity}`}
          </span>
        )}
      </button>
    </div>
  );
}

/** Where the carried session would land: red with the reason when it can't, amber when it would overlap. */
function DropPreview({
  session,
  heightPx,
  blocked,
  hint,
}: {
  session: ScheduleSession;
  heightPx: number;
  blocked: string | null;
  hint: string | null;
}) {
  return (
    <div
      aria-hidden
      style={{
        height: heightPx,
        ...(blocked || hint ? {} : blockStyle(session)),
      }}
      className={`pointer-events-none absolute inset-x-0.5 top-0 z-20 overflow-hidden rounded-md border-2 border-dashed p-1.5 text-[13px] leading-tight font-semibold shadow-[0_2px_10px_rgba(27,21,48,0.25)] ${
        blocked
          ? "border-red-600 bg-red-100/90 text-red-800"
          : hint
            ? "border-amber-500 bg-amber-100/90 text-amber-900"
            : "text-[#1b1530] opacity-85"
      }`}
    >
      <span className="line-clamp-3">{blocked ?? hint ?? session.title}</span>
    </div>
  );
}

type Column = {
  id: string;
  name: string;
  detail: string | null;
  thumbnailUrl: string | null;
};

function GridDay({
  day,
  columns,
  locations,
  going,
  sessions,
  carrying,
  carryMinutes,
  muted,
  onOpen,
  onCreate,
  onGrab,
  onDrop,
  confirmClash,
}: {
  day: Day;
  columns: Column[];
  locations: ScheduleLocation[];
  going: Record<string, number>;
  /** Every session, for overlap checks that cross midnight. */
  sessions: ScheduleSession[];
  carrying: ScheduleSession | null;
  carryMinutes?: number;
  muted?: (s: ScheduleSession) => boolean;
  onOpen: OpenFn;
  onCreate?: CreateFn;
  onGrab: GrabFn;
  onDrop: DropFn;
  confirmClash?: boolean;
}) {
  const [hover, setHover] = useState<{
    dayKey: string;
    slotStart: number;
    colId: string;
  } | null>(null);
  const target = (slotStart: number, colId: string) => {
    if (!carrying) return null;
    const start = fromPacificWall(`${day.key}T${minutesToHHMM(slotStart)}`);
    if (!start) return null;
    const locationId = colId === NO_ROOM ? null : colId;
    const full = carryMinutes
      ? {
          startsAt: start,
          endsAt: new Date(start.getTime() + carryMinutes * 60_000),
        }
      : movedTimes(carrying, start);
    const capped = confirmClash ? capAtMidnight(full) : null;
    const times = capped ?? full;
    const cut =
      capped?.cutFromMinutes != null
        ? { endsAt: capped.endsAt, fromMinutes: capped.cutFromMinutes }
        : null;
    const clash = findClash(
      sessions,
      { id: carrying.id, locationId, ...times },
      locations,
    );
    const overlaps = clash && `Overlaps ${clash.title}`;
    const hint = [cut && "Shortened at midnight", overlaps]
      .filter(Boolean)
      .join(" · ");
    return {
      startsAt: times.startsAt,
      endsAt: times.endsAt,
      locationId,
      clash,
      cut,
      blocked:
        outsideHours(times.startsAt, times.endsAt)?.error ??
        (confirmClash ? null : overlaps),
      hint: confirmClash ? hint || null : null,
    };
  };
  const lanes = useMemo(() => overlapLanes(day.sessions), [day.sessions]);
  const gridCols = `var(--time-w) repeat(${columns.length}, minmax(var(--col-w), 1fr))`;
  return (
    <div
      onMouseLeave={() => setHover(null)}
      className="max-h-[75vh] overflow-auto rounded-xl border border-line bg-white [--col-w:104px] [--time-w:36px] sm:[--col-w:120px] sm:[--time-w:40px]"
    >
      <div className="min-w-fit">
        <div
          className="sticky top-0 z-30 grid bg-navy text-white"
          style={{ gridTemplateColumns: gridCols }}
        >
          <div className="sticky left-0 z-40 border-r border-b border-line bg-navy" />
          {columns.map((col) => (
            <div
              key={col.id}
              className="border-r border-b border-line px-2 py-2 last:border-r-0"
            >
              {col.thumbnailUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- already thumbnail-sized
                <img
                  src={col.thumbnailUrl}
                  alt=""
                  className="mb-1.5 h-14 w-full rounded-sm object-cover"
                />
              )}
              <div className="text-sm leading-tight font-bold">{col.name}</div>
              {col.detail && (
                <div className="text-[11px] leading-tight text-white/75">
                  {col.detail}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="grid" style={{ gridTemplateColumns: gridCols }}>
          {day.slots.map((slotStart) => (
            <div key={slotStart} className="contents">
              <div
                className="sticky left-0 z-20 flex justify-center border-r border-b border-line bg-white pt-1 text-[11px] text-ink/55"
                style={{ height: SLOT_PX }}
              >
                {slotLabel(slotStart, { period: false })}
              </div>
              {columns.map((col) => {
                const inSlot = cellSessions(day.sessions, col.id, slotStart);
                const hovered =
                  carrying &&
                  hover?.dayKey === day.key &&
                  hover.slotStart === slotStart &&
                  hover.colId === col.id
                    ? target(slotStart, col.id)
                    : null;
                return (
                  <div
                    key={col.id}
                    className="relative border-r border-b border-line/60 last:border-r-0"
                    style={{ height: SLOT_PX }}
                  >
                    <button
                      type="button"
                      aria-label={`${carrying ? `Move ${carrying.title} to` : "New session"} ${day.name} ${slotLabel(slotStart)}${col.id === NO_ROOM ? "" : ` in ${col.name}`}`}
                      disabled={!carrying && !onCreate}
                      onMouseEnter={() =>
                        setHover({ dayKey: day.key, slotStart, colId: col.id })
                      }
                      onDragEnter={() =>
                        setHover({ dayKey: day.key, slotStart, colId: col.id })
                      }
                      onDragOver={(e) => {
                        const t = target(slotStart, col.id);
                        // Accepting the drag is what lets it drop here.
                        if (t && !t.blocked) e.preventDefault();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const t = target(slotStart, col.id);
                        if (t && !t.blocked)
                          onDrop(t.startsAt, t.locationId, t.clash, t.cut);
                      }}
                      onClick={() => {
                        if (!carrying) {
                          onCreate?.({
                            day: day.key,
                            startMin: slotStart,
                            locationId: col.id === NO_ROOM ? null : col.id,
                          });
                          return;
                        }
                        const t = target(slotStart, col.id);
                        if (t && !t.blocked)
                          onDrop(t.startsAt, t.locationId, t.clash, t.cut);
                      }}
                      className={`absolute inset-0 transition-colors enabled:hover:bg-navy/[0.06] ${
                        !carrying
                          ? onCreate
                            ? "cursor-cell"
                            : "cursor-default"
                          : hovered?.blocked
                            ? "cursor-not-allowed"
                            : "cursor-copy"
                      }`}
                    />
                    {inSlot.map((s) => (
                      <SessionBlock
                        key={s.id}
                        session={s}
                        slotStart={slotStart}
                        lane={lanes.get(s.id)}
                        going={going[s.id] ?? 0}
                        carrying={carrying}
                        muted={muted?.(s) ?? false}
                        onOpen={onOpen}
                        onGrab={onGrab}
                      />
                    ))}
                    {carrying && hovered && (
                      <DropPreview
                        session={carrying}
                        blocked={hovered.blocked}
                        hint={hovered.hint}
                        heightPx={Math.max(
                          SLOT_PX,
                          ((hovered.endsAt.getTime() -
                            hovered.startsAt.getTime()) /
                            60_000) *
                            (SLOT_PX / SLOT_MINUTES),
                        )}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ListDay({
  day,
  roomName,
  onOpen,
}: {
  day: Day;
  roomName: (id: string | null) => string | null;
  onOpen: OpenFn;
}) {
  if (day.sessions.length === 0) {
    return (
      <p className="rounded-xl border border-line bg-white px-4 py-6 text-center text-sm text-ink/50">
        Nothing on {day.name} yet.
      </p>
    );
  }
  return (
    <ol className="divide-y divide-line rounded-xl border border-line bg-white">
      {day.sessions.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            onClick={() => onOpen(s)}
            className="flex w-full items-stretch gap-3 px-3 py-2.5 text-left transition-colors hover:bg-ink/[0.04]"
          >
            <div className="w-14 shrink-0 pt-0.5 text-right sm:w-16">
              <div className="text-sm font-semibold whitespace-nowrap">
                {formatPacificTime(s.startsAt)}
              </div>
              <div className="text-[11px] whitespace-nowrap text-ink/50">
                {formatPacificTime(s.endsAt)}
              </div>
            </div>
            <div
              aria-hidden
              className={`w-1.5 shrink-0 rounded-full border ${s.status === "draft" ? "border-dashed opacity-60" : ""}`}
              style={blockStyle(s)}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-1.5 leading-tight font-semibold">
                <span>{s.title}</span>
                <AgeMark ages={s.ages} />
                {s.status === "draft" && (
                  <span className="ml-1 rounded bg-ink/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-ink/60 uppercase">
                    Draft
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[13px] text-ink/65">
                {[roomName(s.locationId) ?? "No room", hostNames(s)]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
          </button>
        </li>
      ))}
    </ol>
  );
}

export default function ScheduleGrid({
  days,
  locations,
  going,
  carrying,
  carryMinutes,
  muted,
  onOpen,
  onCreate,
  onGrab,
  onDrop,
  confirmClash,
  dayKey: controlledDay,
  onDayChange,
}: {
  days: Day[];
  locations: ScheduleLocation[];
  /** Going RSVPs per session id. */
  going: Record<string, number>;
  carrying: ScheduleSession | null;
  /** Length to book for a carried session that has no times of its own yet. */
  carryMinutes?: number;
  /** Sessions to show greyed and fixed, for reference. */
  muted?: (s: ScheduleSession) => boolean;
  onOpen: OpenFn;
  /** Clicking an empty slot; without it empty slots only take drops. */
  onCreate?: CreateFn;
  onGrab: GrabFn;
  onDrop: DropFn;
  /** Let drops onto an overlap through (with its clash) instead of refusing them. */
  confirmClash?: boolean;
  /** Controlled day tab, for a parent that needs to switch it (search). */
  dayKey?: string;
  onDayChange?: (key: string) => void;
}) {
  const [ownDay, setOwnDay] = useState(() => openingDayKey(days));
  const setDayKey = onDayChange ?? setOwnDay;
  const [view, setView] = useState<View>("grid");

  const columns: Column[] = locations.map((l) => ({
    id: l.id,
    name: l.name,
    thumbnailUrl: l.thumbnailUrl,
    detail:
      [
        l.campusLocation,
        l.capacity ? `Max ${l.capacity}` : null,
        l.visibility === "public" ? null : l.visibility,
      ]
        .filter(Boolean)
        .join(" · ") || null,
  }));
  if (days.some((d) => d.sessions.some((s) => s.locationId === null))) {
    columns.push({
      id: NO_ROOM,
      name: "No room",
      detail: "unassigned",
      thumbnailUrl: null,
    });
  }
  const roomName = (id: string | null) =>
    locations.find((l) => l.id === id)?.name ?? null;

  const day = selectedDay(days, controlledDay ?? ownDay);
  const placed = days.flatMap((d) => d.sessions);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Conference day"
          className="inline-flex overflow-hidden rounded-lg border border-line bg-white"
        >
          {days.map((d, i) => {
            const active = d.key === day.key;
            return (
              <button
                key={d.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setDayKey(d.key)}
                className={`px-3 py-2 text-sm font-semibold transition-colors sm:px-4 ${
                  active ? "bg-navy text-white" : "text-ink/70 hover:bg-ink/5"
                } ${i > 0 ? "border-l border-line" : ""}`}
              >
                {d.name}
                <span className="ml-1.5 text-xs font-normal whitespace-nowrap opacity-70">
                  {d.dateLabel}
                </span>
                {d.sessions.length > 0 && (
                  <span className="ml-1.5 text-xs font-normal opacity-70">
                    ({d.sessions.length})
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {LEGEND.slice(0, 4).map((entry) => (
              <span
                key={entry.label}
                className="flex items-center gap-1.5 text-xs text-ink/70"
              >
                <span
                  aria-hidden
                  className="h-3 w-3 rounded-sm border"
                  style={entry.style}
                />
                {entry.label}
              </span>
            ))}
            <span className="flex items-center gap-1.5 text-xs text-ink/70">
              <span
                aria-hidden
                className="h-3 w-3 rounded-sm border border-dashed border-ink/40 bg-ink/5"
              />
              Draft
            </span>
          </div>
          <div
            role="group"
            aria-label="View"
            className="inline-flex overflow-hidden rounded-lg border border-line bg-white"
          >
            {(
              [
                { id: "grid", label: "Grid", Icon: FaThLarge },
                { id: "list", label: "List", Icon: FaListUl },
              ] as const
            ).map(({ id, label, Icon }, i) => {
              const active = view === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setView(id)}
                  className={`flex items-center gap-1.5 px-2.5 py-2 text-xs font-semibold transition-colors ${
                    active ? "bg-navy text-white" : "text-ink/70 hover:bg-ink/5"
                  } ${i > 0 ? "border-l border-line" : ""}`}
                >
                  <Icon size={11} />
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {view === "grid" ? (
        columns.length === 0 ? (
          <p className="rounded-xl border border-line bg-white px-4 py-6 text-center text-sm text-ink/50">
            Add a room to get a grid.
          </p>
        ) : (
          <GridDay
            day={day}
            columns={columns}
            locations={locations}
            going={going}
            sessions={placed}
            carrying={carrying}
            carryMinutes={carryMinutes}
            muted={muted}
            onOpen={onOpen}
            onCreate={onCreate}
            onGrab={onGrab}
            onDrop={onDrop}
            confirmClash={confirmClash}
          />
        )
      ) : (
        <ListDay day={day} roomName={roomName} onOpen={onOpen} />
      )}
    </div>
  );
}
