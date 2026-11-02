"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FaClock, FaListUl, FaThLarge } from "react-icons/fa";
import {
  cellSessions,
  formatPacificTime,
  heightPx,
  hostNames,
  laneInset,
  NO_ROOM,
  nowLinePx,
  offsetPx,
  overlapLanes,
  slotLabel,
  SLOT_PX,
  type Ages,
  type Category,
  type Lane,
  type PublicLocation,
} from "@/lib/schedule";
import { AgeMark, BlockSummary, blockStyle, SponsorTag } from "./SessionBits";

// The day grid, the day list and the toggles the schedule is built from,
// shared by /schedule and the profile pages' session views.

/** The least a session needs to be drawn in either view. */
export type ViewSession = {
  id: string;
  slug: string;
  title: string;
  category: Category | null;
  ages: Ages | null;
  sponsored: boolean;
  locationId: string | null;
  hosts: { name: string }[];
  startsAt: string;
  endsAt: string;
};

export type ViewDay<S extends ViewSession> = {
  key: string;
  name: string;
  dateLabel: string;
  sessions: S[];
  slots: number[];
};

export type Column = {
  id: string;
  name: string;
  campusLocation: string | null;
  capacity: number | null;
  thumbnailUrl: string | null;
};

/** Room columns in order, with a "Room TBA" column when anything needs one. */
export function buildColumns(
  locations: PublicLocation[],
  roomless: boolean,
): Column[] {
  const columns: Column[] = locations.map((l) => ({
    id: l.id,
    name: l.name,
    campusLocation: l.campusLocation,
    capacity: l.capacity,
    thumbnailUrl: l.thumbnailUrl,
  }));
  if (roomless) {
    columns.push({
      id: NO_ROOM,
      name: "Room TBA",
      campusLocation: null,
      capacity: null,
      thumbnailUrl: null,
    });
  }
  return columns;
}

export const TOGGLE = "inline-flex border-[1.5px] border-[#1b1530]/25";
export const toggleButton = (active: boolean, i: number) =>
  `${active ? "bg-[#1b1530] text-[#f4ecd2]" : "text-[#1b1530]/70 hover:bg-[#1b1530]/5"} ${
    i > 0 ? "border-l-[1.5px] border-[#1b1530]/25" : ""
  }`;

export function DayTabs({
  days,
  selected,
  onSelect,
}: {
  days: { key: string; name: string; dateLabel: string }[];
  selected: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div role="tablist" aria-label="Conference day" className={TOGGLE}>
      {days.map((d, i) => (
        <button
          key={d.key}
          type="button"
          role="tab"
          aria-selected={d.key === selected}
          onClick={() => onSelect(d.key)}
          className={`px-4 py-2 font-[family-name:var(--font-bebas)] text-lg tracking-[0.06em] transition-colors sm:px-6 sm:text-xl ${toggleButton(d.key === selected, i)}`}
        >
          {d.name}
          <span className="ml-1.5 inline-block text-sm whitespace-nowrap opacity-70">
            {d.dateLabel}
          </span>
        </button>
      ))}
    </div>
  );
}

const VIEWS = [
  { id: "grid", label: "Grid", Icon: FaThLarge },
  { id: "list", label: "List", Icon: FaListUl },
  { id: "moments", label: "Moments", Icon: FaClock },
] as const;

export type View = (typeof VIEWS)[number]["id"];

export function ViewToggle({
  view,
  onSelect,
  labels,
  views = ["grid", "list"],
}: {
  view: View;
  onSelect: (v: View) => void;
  labels?: Partial<Record<View, string>>;
  views?: View[];
}) {
  return (
    <div role="group" aria-label="View" className={TOGGLE}>
      {VIEWS.filter((v) => views.includes(v.id)).map(
        ({ id, label, Icon }, i) => (
          <button
            key={id}
            type="button"
            aria-pressed={view === id}
            onClick={() => onSelect(id)}
            className={`flex items-center gap-2 px-3 py-2.5 text-xs tracking-[0.12em] uppercase transition-colors ${toggleButton(view === id, i)}`}
          >
            <Icon size={12} />
            {labels?.[id] ?? label}
          </button>
        ),
      )}
    </div>
  );
}

const BLOCK =
  "absolute inset-x-0.5 z-10 block overflow-hidden rounded-md border p-1.5 text-left text-[#1b1530]";
const BLOCK_LINK =
  "transition-shadow hover:z-20 hover:shadow-[0_2px_10px_rgba(27,21,48,0.25)]";

function SessionBlock<S extends ViewSession>({
  session,
  slotStart,
  lane,
  href,
  badge,
}: {
  session: S;
  slotStart: number;
  lane: Lane | undefined;
  href: (s: S) => string | null;
  badge?: (s: S) => ReactNode;
}) {
  const style = {
    top: offsetPx(session, slotStart),
    height: heightPx(session),
    ...laneInset(lane),
    ...blockStyle(session),
  };
  const title = `${session.title}${session.hosts.length ? " — " + hostNames(session) : ""}`;
  const body = (
    <>
      <BlockSummary session={session} />
      {badge?.(session)}
    </>
  );
  const to = href(session);
  if (!to) {
    return (
      <div title={title} style={style} className={BLOCK}>
        {body}
      </div>
    );
  }
  return (
    <Link
      title={title}
      href={to}
      style={style}
      className={`${BLOCK} ${BLOCK_LINK}`}
    >
      {body}
    </Link>
  );
}

/** The current time, ticking each minute; null until mounted so the server render matches. */
const NOW_TICK_MS = 5_000;

function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, NOW_TICK_MS);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** One day as a room-by-time grid, the way the printed schedule reads. */
export function GridDay<S extends ViewSession>({
  day,
  columns,
  href,
  badge,
}: {
  day: ViewDay<S>;
  columns: Column[];
  href: (s: S) => string | null;
  badge?: (s: S) => ReactNode;
}) {
  const lanes = useMemo(() => overlapLanes(day.sessions), [day.sessions]);
  const gridCols = `var(--time-w) repeat(${columns.length}, minmax(var(--col-w), 1fr))`;
  const now = useNow();
  const nowTop = now ? nowLinePx(day.key, day.slots[0], now) : null;
  return (
    <div className="overflow-x-auto border-[1.5px] border-[#1b1530]/15 bg-background [--col-w:104px] [--time-w:36px] sm:[--col-w:120px] sm:[--time-w:40px]">
      <div className="min-w-fit">
        <div
          className="sticky top-0 z-30 grid bg-[#4096ff] text-white"
          style={{ gridTemplateColumns: gridCols }}
        >
          <div className="sticky left-0 z-40 border-r border-b border-[#1b1530]/15 bg-[#4096ff]" />
          {columns.map((col) => (
            <div
              key={col.id}
              className="border-r border-b border-[#1b1530]/15 px-2 py-2 last:border-r-0"
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
              {col.campusLocation && (
                <div className="text-[11px] leading-tight text-white/75">
                  {col.campusLocation}
                </div>
              )}
              {col.capacity && (
                <div className="text-[11px] leading-tight text-white/75">
                  Max {col.capacity}
                </div>
              )}
            </div>
          ))}
        </div>

        <div
          className="relative grid"
          style={{ gridTemplateColumns: gridCols }}
        >
          {nowTop !== null && (
            <div
              aria-hidden
              className="pointer-events-none absolute right-0 left-0 z-[25] h-0.5 bg-red-600 transition-[top] ease-linear"
              style={{ top: nowTop, transitionDuration: `${NOW_TICK_MS}ms` }}
            />
          )}
          {day.slots.map((slotStart) => (
            <div key={slotStart} className="contents">
              <div
                className="sticky left-0 z-20 flex justify-center border-r border-b border-[#1b1530]/15 bg-background pt-1 text-[11px] text-[#1b1530]/55"
                style={{ height: SLOT_PX }}
              >
                {slotLabel(slotStart, { period: false })}
              </div>
              {columns.map((col) => (
                <div
                  key={col.id}
                  className="relative border-r border-b border-[#1b1530]/10 last:border-r-0"
                  style={{ height: SLOT_PX }}
                >
                  {cellSessions(day.sessions, col.id, slotStart).map((s) => (
                    <SessionBlock
                      key={s.id}
                      session={s}
                      slotStart={slotStart}
                      lane={lanes.get(s.id)}
                      href={href}
                      badge={badge}
                    />
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const ROW = "flex w-full items-stretch gap-3 px-3 py-2.5 text-left";

/** One session as a list row: time, category stripe, title, room and hosts. */
export function SessionRow<S extends ViewSession>({
  session,
  roomName,
  href,
  badge,
}: {
  session: S;
  roomName: (id: string | null) => string | null;
  href: (s: S) => string | null;
  badge?: (s: S) => ReactNode;
}) {
  const body = (
    <>
      <div className="w-14 shrink-0 pt-0.5 text-right sm:w-16">
        <div className="text-sm font-semibold whitespace-nowrap">
          {formatPacificTime(session.startsAt)}
        </div>
        <div className="text-[11px] whitespace-nowrap text-[#1b1530]/50">
          {formatPacificTime(session.endsAt)}
        </div>
      </div>
      <div
        aria-hidden
        className="w-1.5 shrink-0 rounded-full border"
        style={blockStyle(session)}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start gap-1.5 leading-tight font-semibold">
          <span>{session.title}</span>
          <AgeMark ages={session.ages} />
          {session.sponsored && <SponsorTag />}
          {badge?.(session)}
        </div>
        <div className="mt-0.5 text-[13px] text-[#1b1530]/65">
          {[roomName(session.locationId), hostNames(session)]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
    </>
  );
  const to = href(session);
  return (
    <li>
      {to ? (
        <Link
          href={to}
          className={`${ROW} transition-colors hover:bg-[#1b1530]/[0.04]`}
        >
          {body}
        </Link>
      ) : (
        <div className={ROW}>{body}</div>
      )}
    </li>
  );
}

export function SessionRows({ children }: { children: ReactNode }) {
  return (
    <ol className="divide-y divide-[#1b1530]/10 border-[1.5px] border-[#1b1530]/15 bg-background">
      {children}
    </ol>
  );
}

export function EmptyPanel({ children }: { children: ReactNode }) {
  return (
    <p className="border-[1.5px] border-[#1b1530]/15 bg-background px-4 py-6 text-center text-sm text-[#1b1530]/55">
      {children}
    </p>
  );
}

/** One day as a plain time-ordered list. */
export function ListDay<S extends ViewSession>({
  day,
  roomName,
  href,
  badge,
}: {
  day: ViewDay<S>;
  roomName: (id: string | null) => string | null;
  href: (s: S) => string | null;
  badge?: (s: S) => ReactNode;
}) {
  if (day.sessions.length === 0)
    return <EmptyPanel>Nothing on {day.name} yet.</EmptyPanel>;
  return (
    <SessionRows>
      {day.sessions.map((s) => (
        <SessionRow
          key={s.id}
          session={s}
          roomName={roomName}
          href={href}
          badge={badge}
        />
      ))}
    </SessionRows>
  );
}
