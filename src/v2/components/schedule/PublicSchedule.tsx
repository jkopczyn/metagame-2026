"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { FaStar } from "react-icons/fa";
import { toast } from "sonner";
import {
  onlySessions,
  openingDayKey,
  selectedDay,
  type Day,
  type PublicLocation,
  type PublicSession,
} from "@/lib/schedule";
import { LEGEND } from "@/v2/lib/schedule-styles";
import {
  buildColumns,
  DayTabs,
  EmptyPanel,
  GridDay,
  ListDay,
  TOGGLE,
  toggleButton,
  ViewToggle,
  type View,
} from "./ScheduleViews";
import ScheduleMoments from "./ScheduleMoments";
import ScheduleSearch from "./ScheduleSearch";

type PublicDay = Day<PublicSession>;

const href = (s: PublicSession) => `/schedule/${encodeURIComponent(s.slug)}`;

export function CategoryLegend() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
      {LEGEND.slice(0, 4).map((entry) => (
        <span key={entry.label} className="flex items-center gap-1.5 text-xs">
          <span
            aria-hidden
            className="h-3.5 w-3.5 rounded-sm border"
            style={entry.style}
          />
          {entry.label}
        </span>
      ))}
    </div>
  );
}

/** The published schedule, a day at a time; every session links to its page. */
export default function PublicSchedule({
  days,
  locations,
  mine,
}: {
  days: PublicDay[];
  locations: PublicLocation[];
  /** Ids of the viewer's own sessions; null when signed out. */
  mine: string[] | null;
}) {
  const [dayKey, setDayKey] = useState(() => openingDayKey(days));
  const [view, setView] = useState<View>("grid");
  const [onlyMine, setOnlyMine] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  // Whichever session page is open, show its day underneath: a search pick,
  // a shared link, or the back button all land on the right tab. State is
  // adjusted during render on a path change rather than in an effect, so the
  // first paint is already on the right day.
  const [seenPath, setSeenPath] = useState(pathname);
  if (pathname !== seenPath) {
    setSeenPath(pathname);
    const slug = decodeURIComponent(pathname.split("/")[2] ?? "");
    const found = slug
      ? days.find((d) => d.sessions.some((s) => s.slug === slug))
      : undefined;
    if (found) setDayKey(found.key);
  }

  // Phones start on moments; deferred so server and first client render match.
  useEffect(() => {
    if (!window.matchMedia("(max-width: 767px)").matches) return;
    const t = setTimeout(() => setView("moments"), 0);
    return () => clearTimeout(t);
  }, []);

  // The layout isn't re-rendered when a session modal closes, so an RSVP or
  // bookmark made in one wouldn't reach `mine` without this.
  useEffect(() => {
    if (onlyMine && pathname === "/schedule") router.refresh();
  }, [onlyMine, pathname, router]);

  const shownDays = useMemo(
    () => (onlyMine && mine ? onlySessions(days, new Set(mine)) : days),
    [days, mine, onlyMine],
  );

  const columns = buildColumns(
    locations,
    days.some((d) => d.sessions.some((s) => s.locationId === null)),
  );
  const roomName = (id: string | null) =>
    locations.find((l) => l.id === id)?.name ?? null;
  const day = selectedDay(shownDays, dayKey);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <ScheduleSearch
          sessions={days.flatMap((d) => d.sessions)}
          roomName={(s) => roomName(s.locationId)}
          onPick={(s) => router.push(href(s), { scroll: false })}
        />
        {mine && (
          <button
            type="button"
            aria-pressed={onlyMine}
            onClick={() => {
              setOnlyMine(!onlyMine);
              toast(
                onlyMine
                  ? "Showing all sessions."
                  : "Now showing only your sessions.",
                { id: "schedule-filter" },
              );
            }}
            className={`${TOGGLE} ml-auto shrink-0 items-center gap-2 px-3 py-2.5 text-xs tracking-[0.12em] uppercase transition-colors ${toggleButton(onlyMine, 0)}`}
          >
            <FaStar size={12} />
            My sessions
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {view !== "moments" && (
          <DayTabs days={days} selected={day.key} onSelect={setDayKey} />
        )}
        <ViewToggle
          view={view}
          onSelect={setView}
          views={["grid", "list", "moments"]}
        />
      </div>

      <CategoryLegend />

      {view === "moments" ? (
        <ScheduleMoments
          days={shownDays}
          columns={columns}
          onOpen={(s) => router.push(href(s), { scroll: false })}
        />
      ) : onlyMine && day.sessions.length === 0 ? (
        <EmptyPanel>
          {mine?.length
            ? `None of your sessions are on ${day.name}.`
            : "Sessions you RSVP to, bookmark or host will show up here."}
        </EmptyPanel>
      ) : view === "grid" && columns.length > 0 ? (
        <GridDay day={day} columns={columns} href={href} />
      ) : (
        <ListDay day={day} roomName={roomName} href={href} />
      )}
    </div>
  );
}
