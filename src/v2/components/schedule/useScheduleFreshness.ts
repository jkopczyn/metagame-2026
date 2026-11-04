"use client";

import { startTransition, useEffect, useRef } from "react";
import type { ScheduleSnapshot } from "@/app/(v2)/schedule/data";
import { refreshDue } from "@/lib/schedule-freshness";
import { noteWritesInFlight, noteWritesStarted } from "./NoteBoard";
import { onPlanChange } from "./plan-sync";

// Per page load, not per mount: moving back and forth remounts the hook.
let lastAttempt = 0;

// Waits on anything a new snapshot could disturb: an open dialog (the session
// modal, a notice being edited, a confirm) or a note's optimistic write.
const busy = () =>
  noteWritesInFlight() > 0 ||
  !!document.querySelector('[role="dialog"],[role="alertdialog"]');

/**
 * Re-reads the schedule on returning to the tab; see schedule-freshness.ts. A
 * return that is held back or whose read fails waits for the next return.
 *
 * A plain fetch, not router.refresh(), which turns a failed request into a
 * browser navigation (a phone waking before its wifi lands on the offline
 * page), and not a server action, which waits its turn behind the viewer's own
 * and re-renders the whole page whenever the session check touches a cookie.
 */
export function useScheduleFreshness(
  readAt: number,
  apply: (snapshot: ScheduleSnapshot) => void,
) {
  const lastFresh = useRef(readAt);
  const latest = useRef(apply);
  useEffect(() => {
    latest.current = apply;
  }, [apply]);
  // Before the effect below: going back to this page restores the props it
  // last had, however old, and that effect's first check reads them.
  useEffect(() => {
    lastFresh.current = Math.min(readAt, Date.now());
  }, [readAt]);

  useEffect(() => {
    let live = true;
    let planChanges = 0;
    let newestRead = 0;
    const writes = () => noteWritesStarted() + planChanges;

    const onReturn = async () => {
      const startedAt = Date.now();
      if (
        document.visibilityState !== "visible" ||
        navigator.onLine === false ||
        busy() ||
        !refreshDue({ lastFresh: lastFresh.current, lastAttempt }, startedAt)
      ) {
        return;
      }
      lastAttempt = startedAt;
      const read = ++newestRead;
      const writesBefore = writes();
      try {
        const res = await fetch("/api/schedule-snapshot", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const snapshot: ScheduleSnapshot = await res.json();
        // It may predate a write made meanwhile. Drop it; the next return
        // reads after that write.
        if (!live || busy() || writes() !== writesBefore) return;
        // A read that stalled past the attempt gap must not undo a newer one.
        if (read !== newestRead) return;
        lastFresh.current = startedAt;
        startTransition(() => latest.current(snapshot));
      } catch {
        // No network; the next return tries again.
      }
    };

    const onChange = () => void onReturn();
    const stopPlans = onPlanChange(() => {
      planChanges += 1;
    });
    void onReturn();
    document.addEventListener("visibilitychange", onChange);
    window.addEventListener("online", onChange);
    return () => {
      live = false;
      stopPlans();
      document.removeEventListener("visibilitychange", onChange);
      window.removeEventListener("online", onChange);
    };
  }, []);
}
