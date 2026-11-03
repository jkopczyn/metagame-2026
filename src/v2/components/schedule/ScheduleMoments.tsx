"use client";

import { useEffect, useState } from "react";
import { type Day, type PublicSession } from "@/lib/schedule";
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
  dayKey,
  onDayChange,
}: {
  days: Day<PublicSession>[];
  columns: Column[];
  onOpen: (session: PublicSession) => void;
  dayKey: string;
  onDayChange: (key: string) => void;
}) {
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
      days={days}
      locations={columns}
      styleFor={blockStyle}
      onOpen={onOpen}
      now={now}
      hideQuiet
      dayKey={dayKey}
      onDayChange={onDayChange}
    />
  );
}
