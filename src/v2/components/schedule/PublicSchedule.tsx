"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { FaStar } from "react-icons/fa";
import { toast } from "sonner";
import {
  currentDayKey,
  onlySessions,
  openingDayKey,
  boardRows,
  hostsBoard,
  SLOT_PX,
  selectedDay,
  type Day,
  type PublicLocation,
  type PublicSession,
} from "@/lib/schedule";
import { SESSION_PARAM, sessionPageSlug } from "@/lib/session-link";
import type { BoardData } from "@/lib/unconference";
import { readViewCookie, writeViewCookie } from "@/lib/schedule-view";
import { onPlanChange, withPlanChange } from "./plan-sync";
import { ScheduleLegend } from "./SessionBits";
import { useOpenSession, useSessionHref } from "./SessionModalHost";
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
import BoardNotes from "./NoteBoard";
import ScheduleMoments from "./ScheduleMoments";
import ScheduleSearch from "./ScheduleSearch";
import UnconferenceBoard, { NoteList } from "./UnconferenceBoard";

type PublicDay = Day<PublicSession>;

/** The day the session with `slug` is on, if it's one of these. */
function sessionDayKey(days: PublicDay[], slug: string | null) {
  if (!slug) return undefined;
  return days.find((d) => d.sessions.some((s) => s.slug === slug))?.key;
}

/** The published schedule, a day at a time; every session opens over it. */
export default function PublicSchedule({
  days,
  locations,
  mine: initialMine,
  board,
  initialView,
}: {
  days: PublicDay[];
  locations: PublicLocation[];
  /** Ids of the viewer's own sessions; null when signed out. */
  mine: string[] | null;
  /** The unconference notes, or null when no room this viewer sees is a board. */
  board?: BoardData | null;
  /** The view cookie as read on the server; undefined where the page is
   *  cached and the cookie has to be read after mount instead. */
  initialView?: View;
}) {
  const pathname = usePathname();
  const href = useSessionHref();
  const openSession = useOpenSession();
  // A session's own page shows its day underneath.
  const [dayKey, setDayKey] = useState(
    () =>
      sessionDayKey(days, sessionPageSlug(pathname)) ??
      // Not on the home page: it's cached, so "today" would go stale in its HTML.
      (pathname === "/schedule"
        ? currentDayKey(days, new Date())
        : openingDayKey(days)),
  );
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

  // The modal's RSVP and bookmark clicks land here rather than in a refresh
  // of the whole page; a newer server read wins, as usual.
  const [plans, setPlans] = useState({ ids: initialMine, from: initialMine });
  if (plans.from !== initialMine) {
    setPlans({ ids: initialMine, from: initialMine });
  }
  const mine = plans.ids;
  const router = useRouter();
  useEffect(() => {
    let changed = false;
    const stop = onPlanChange((change) => {
      changed = true;
      setPlans((p) =>
        p.ids ? { ...p, ids: withPlanChange(p.ids, change) } : p,
      );
    });
    return () => {
      stop();
      // Going back restores cached pages, which still have the old plans.
      if (changed) router.refresh();
    };
  }, [router]);

  // Landing with ?session= open (coming back from sign-in) shows that day
  // too. Read off the location: useSearchParams would need a Suspense
  // boundary, and the home page would lose its prerendered schedule. Once
  // only: on the home page a refresh hands over a new `days`.
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current) return;
    const slug = new URLSearchParams(window.location.search).get(SESSION_PARAM);
    const key = sessionDayKey(days, slug);
    if (!key) {
      landed.current = true;
      return;
    }
    // Marked inside the timer: Strict Mode's re-run would otherwise skip it.
    const t = setTimeout(() => {
      landed.current = true;
      setDayKey(key);
    }, 0);
    return () => clearTimeout(t);
  }, [days]);

  const open = (s: PublicSession) => {
    openSession(s.slug);
  };

  const shownDays = useMemo(
    () => (onlyMine && mine ? onlySessions(days, new Set(mine)) : days),
    [days, mine, onlyMine],
  );

  const columns = buildColumns(locations);
  const roomName = (id: string | null) =>
    locations.find((l) => l.id === id)?.name ?? null;
  const day = selectedDay(shownDays, dayKey);
  // Each day the board is up is its own board. Notes aren't sessions, so
  // they can't go through ListDay (shared with the profile pages) or Moments.
  const noteLists = (board ? locations.filter(hostsBoard) : []).flatMap(
    (room) => {
      const rows = boardRows(room, day.key, day.slots);
      return rows
        ? [
            <NoteList
              key={room.id}
              locationId={room.id}
              dayKey={day.key}
              name={room.name}
              height={(rows[1] - rows[0]) * SLOT_PX}
            />,
          ]
        : [];
    },
  );

  const schedule = (
    <div className="flex flex-col gap-5">
      {/* On a phone the view toggle shares this row as icons, and the My
          sessions button keeps only its star; both get their words back from
          the sm breakpoint. */}
      <div className="flex items-center gap-2 sm:gap-3">
        <ScheduleSearch
          sessions={days.flatMap((d) => d.sessions)}
          roomName={(s) => roomName(s.locationId)}
          onPick={(s) => {
            // Its day underneath, so closing lands on the right tab.
            const key = sessionDayKey(days, s.slug);
            if (key) setDayKey(key);
            open(s);
          }}
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
        <>
          <ScheduleMoments
            days={shownDays}
            columns={columns}
            onOpen={open}
            dayKey={day.key}
            onDayChange={setDayKey}
          />
          {noteLists}
        </>
      ) : onlyMine && day.sessions.length === 0 ? (
        <EmptyPanel>
          {mine?.length
            ? `None of your sessions are on ${day.name}.`
            : "Sessions you RSVP to, bookmark or host will show up here."}
        </EmptyPanel>
      ) : view === "grid" && columns.length > 0 ? (
        <GridDay
          day={day}
          columns={columns}
          href={(s) => href(s.slug)}
          board={
            board
              ? ({ column, dayKey }) => (
                  <UnconferenceBoard
                    locationId={column.id}
                    dayKey={dayKey}
                    firstSlot={day.slots[0]}
                    // Every session that day, not just "My sessions".
                    sessions={
                      days.find((d) => d.key === dayKey)?.sessions ?? []
                    }
                  />
                )
              : undefined
          }
        />
      ) : (
        <>
          <ListDay day={day} roomName={roomName} href={(s) => href(s.slug)} />
          {noteLists}
        </>
      )}
    </div>
  );

  // The notes live above every view: switching view or day tab must not throw
  // away a note that was just pinned up, since nothing revalidates the route.
  return board ? <BoardNotes board={board}>{schedule}</BoardNotes> : schedule;
}
