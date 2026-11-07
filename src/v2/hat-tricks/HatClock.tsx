"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatClockTime } from "@/lib/hat-tricks-format";
import { DISPLAY } from "@/v2/components/styles";

const REFRESH_MS = 60_000;

/**
 * The event clock. It gets only the instants it displays, never the schedule.
 * The first render shows the server's label so hydration matches, and the tick
 * corrects for the difference between the browser clock and the server's.
 */
export default function HatClock({
  nowIso,
  nowLabel,
  refreshAt,
  endsAtLabel,
  nextLine,
}: {
  nowIso: string;
  nowLabel: string;
  refreshAt: string | null;
  endsAtLabel: string | null;
  nextLine: string | null;
}) {
  const router = useRouter();
  const [label, setLabel] = useState(nowLabel);
  const refreshedFor = useRef<string | null>(null);

  useEffect(() => {
    const offset = Date.parse(nowIso) - Date.now();
    const deadline = refreshAt === null ? null : Date.parse(refreshAt);

    const tick = () => {
      const at = Date.now() + offset;
      setLabel(formatClockTime(new Date(at)));
      if (
        deadline !== null &&
        refreshAt !== null &&
        refreshedFor.current !== refreshAt &&
        at >= deadline
      ) {
        refreshedFor.current = refreshAt;
        router.refresh();
      }
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [nowIso, refreshAt, router]);

  // Nothing pushes to an open page, and a new schedule or steal should reach it.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [router]);

  return (
    <div>
      <p className={`${DISPLAY} text-[clamp(32px,6vw,52px)] text-navy`}>
        {label}
      </p>
      {endsAtLabel && (
        <p className="mt-2 text-base text-ink/70">
          This shift ends at {endsAtLabel}
        </p>
      )}
      {nextLine && <p className="mt-1 text-base text-ink/70">{nextLine}</p>}
    </div>
  );
}
