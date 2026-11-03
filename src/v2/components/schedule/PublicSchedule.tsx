"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { FaStar } from "react-icons/fa";
import { toast } from "sonner";
import {
  onlySessions,
  openingDayKey,
  selectedDay,
  sessionHref as href,
  type Day,
  type PublicLocation,
  type PublicSession,
} from "@/lib/schedule";
import { readViewCookie, writeViewCookie } from "@/lib/schedule-view";
import { ScheduleLegend } from "./SessionBits";
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

/** The published schedule, a day at a time; every session links to its page. */
export default function PublicSchedule({
  days,
  locations,
  mine,
  initialView,
}: {
  days: PublicDay[];
  locations: PublicLocation[];
  /** Ids of the viewer's own sessions; null when signed out. */
  mine: string[] | null;
  /** The view cookie as read on the server; undefined where the page is
   *  cached and the cookie has to be read after mount instead. */
  initialView?: View;
}) {
  const [dayKey, setDayKey] = useState(() => openingDayKey(days));
  const [view, setView] = useState<View>(initialView ?? "grid");
  const selectView = (v: View) => {
    setView(v);
    writeViewCookie(v);
  };

  // Without a server-read view, pick up the one stored in the browser;
  // deferred so server and first client render match.
  useEffect(() => {
    if (initialView) return;
    const stored = readViewCookie();
    if (!stored) return;
    const t = setTimeout(() => setView(stored), 0);
    return () => clearTimeout(t);
  }, [initialView]);
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

  // The layout isn't re-rendered when a session modal closes, so an RSVP or
  // bookmark made in one wouldn't reach `mine` without this.
  useEffect(() => {
    if (onlyMine && pathname === "/schedule") router.refresh();
  }, [onlyMine, pathname, router]);

  const shownDays = useMemo(
    () => (onlyMine && mine ? onlySessions(days, new Set(mine)) : days),
    [days, mine, onlyMine],
  );

  const columns = buildColumns(locations);
  const roomName = (id: string | null) =>
    locations.find((l) => l.id === id)?.name ?? null;
  const day = selectedDay(shownDays, dayKey);

  return (
    <div className="flex flex-col gap-5">
      {/* On a phone the view toggle shares this row as icons, and the My
          sessions button keeps only its star; both get their words back from
          the sm breakpoint. */}
      <div className="flex items-center gap-2 sm:gap-3">
        <ScheduleSearch
          sessions={days.flatMap((d) => d.sessions)}
          roomName={(s) => roomName(s.locationId)}
          onPick={(s) => router.push(href(s), { scroll: false })}
          className="min-w-0"
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
            title="Only my sessions"
            className={`${TOGGLE} ml-auto shrink-0 items-center gap-2 px-3 py-2.5 text-xs tracking-[0.12em] uppercase transition-colors ${toggleButton(onlyMine, 0)}`}
          >
            <FaStar size={12} />
            <span className="sr-only sm:not-sr-only">My sessions</span>
          </button>
        )}
        <ViewToggle
          view={view}
          onSelect={selectView}
          views={["grid", "list", "moments"]}
          iconsOnly
          className={`${mine ? "" : "ml-auto"} shrink-0 sm:hidden`}
        />
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <DayTabs days={days} selected={day.key} onSelect={setDayKey} />
        <div className="hidden sm:block">
          <ViewToggle
            view={view}
            onSelect={selectView}
            views={["grid", "list", "moments"]}
          />
        </div>
      </div>

      <ScheduleLegend />

      {view === "moments" ? (
        <ScheduleMoments
          days={shownDays}
          columns={columns}
          onOpen={(s) => router.push(href(s), { scroll: false })}
          dayKey={day.key}
          onDayChange={setDayKey}
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
