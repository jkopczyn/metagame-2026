"use client";

import { useState } from "react";
import type { ScheduleSnapshot } from "@/app/(v2)/schedule/data";
import type { View } from "./ScheduleViews";
import PublicSchedule from "./PublicSchedule";
import { useScheduleFreshness } from "./useScheduleFreshness";

/** /schedule's PublicSchedule, brought up to date on returning to an old tab. */
export default function LiveSchedule({
  initial,
  initialView,
}: {
  initial: ScheduleSnapshot;
  initialView?: View;
}) {
  const [state, setState] = useState({ snapshot: initial, from: initial });
  // A server render (a ticket just activated) is as fresh as a re-read.
  if (state.from !== initial) setState({ snapshot: initial, from: initial });
  useScheduleFreshness(initial.readAt, (snapshot) =>
    setState((s) => ({ ...s, snapshot })),
  );

  const { days, locations, mine, board } = state.snapshot;
  return (
    <PublicSchedule
      days={days}
      locations={locations}
      mine={mine}
      board={board}
      initialView={initialView}
    />
  );
}
