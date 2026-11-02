"use client";

import { useEffect, useMemo, useState } from "react";
import { NO_ROOM, type Day, type PublicSession } from "@/lib/schedule";
import { momentAt, type Moment } from "@/v2/lib/moments";
import Moments from "./Moments";
import type { Column } from "./ScheduleViews";
import { blockStyle } from "./SessionBits";

const RESYNC_MS = 30_000;

/** The public schedule on the Moments board, following the clock while the conference is on. */
export default function ScheduleMoments({
  days,
  columns,
  onOpen,
}: {
  days: Day<PublicSession>[];
  columns: Column[];
  onOpen: (session: PublicSession) => void;
}) {
  // The board places sessions by room, so roomless ones go under "Room TBA".
  const boardDays = useMemo(
    () =>
      days.map((d) => ({
        ...d,
        sessions: d.sessions.map((s) => ({
          ...s,
          locationId: s.locationId ?? NO_ROOM,
        })),
      })),
    [days],
  );

  // Only the browser knows the time, so this starts empty and fills in after mount.
  const [now, setNow] = useState<Moment | null>(null);
  useEffect(() => {
    const sync = () => setNow(momentAt(days, new Date()));
    const first = setTimeout(sync, 0);
    const id = setInterval(sync, RESYNC_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [days]);

  return (
    <Moments
      days={boardDays}
      locations={columns}
      styleFor={blockStyle}
      onOpen={onOpen}
      now={now}
      hideQuiet
    />
  );
}
