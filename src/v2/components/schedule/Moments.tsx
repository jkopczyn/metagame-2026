"use client";

import {
  useEffect,
  useMemo,
  useReducer,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { Pause, Play } from "lucide-react";
import {
  formatPacificTime,
  pacificMinutes,
  slotLabel,
  SLOT_MINUTES,
} from "@/lib/schedule";
import { boardDays, type Moment } from "@/v2/lib/moments";
import type { LegendEntry } from "@/v2/lib/schedule-styles";
import { DISPLAY } from "../styles";

/** The least a session needs to be placed on the board. */
export type MomentSession = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  locationId: string | null;
};

/** One tab of the board: its sessions and its 30-minute slot starts. */
export type MomentsDay<S extends MomentSession> = {
  key: string;
  name: string;
  sessions: S[];
  slots: number[];
};

export type { Moment };

type Props<S extends MomentSession> = {
  days: MomentsDay<S>[];
  locations: { id: string; name: string }[];
  styleFor: (session: S) => CSSProperties;
  onOpen: (session: S, day: MomentsDay<S>) => void;
  legend?: LegendEntry[];
  /** Where the board opens; the busiest moment when omitted. */
  startAt?: Moment;
  /** The current moment, when it's on the board: the board follows it until
   * the viewer moves the clock, and offers a way back. */
  now?: Moment | null;
  /** Leave out rooms with nothing on at the moment shown. */
  hideQuiet?: boolean;
};

// How far the clock moves per tick of playback, and how often it ticks.
const STEP = 15;
const TICK_MS = 700;

// Radius of the open circles that bookend the timeline, in px. The time axis
// runs between their centres, so the track is inset by this much each side.
const END_R = 7;

const hourLabel = (t: number) => {
  const h = Math.floor(t / 60) % 24;
  return `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
};

type Span<S extends MomentSession> = {
  day: MomentsDay<S>;
  name: string;
  start: number;
  end: number;
  timed: { s: S; a: number; b: number }[];
};

// Each day's sessions as minutes since Pacific midnight, and the day's span.
function toSpans<S extends MomentSession>(days: MomentsDay<S>[]): Span<S>[] {
  return boardDays(days).map((d) => ({
    day: d,
    name: d.name,
    start: d.slots[0],
    end: d.slots[d.slots.length - 1] + SLOT_MINUTES,
    timed: d.sessions.map((s) => {
      const a = pacificMinutes(s.startsAt);
      const b = pacificMinutes(s.endsAt);
      return { s, a, b: b <= a ? b + 24 * 60 : b };
    }),
  }));
}

const runningAt = <S extends MomentSession>(d: Span<S>, t: number) =>
  d.timed.filter((x) => x.a <= t && t < x.b);

// The moment with the most sessions running, so the board starts full.
function busiest(spans: Span<MomentSession>[]): Moment {
  let best = { day: 0, t: spans[0].start, n: -1 };
  spans.forEach((d, day) => {
    for (let t = d.start; t < d.end; t += STEP) {
      const n = runningAt(d, t).length;
      if (n > best.n) best = { day, t, n };
    }
  });
  return { day: best.day, t: best.t };
}

type State = Moment & { playing: boolean };
type Action =
  | { type: "tick" | "toggle" | "pause" }
  | { type: "seek"; t: number }
  | { type: "day"; day: number }
  | ({ type: "goto" } & Moment);

function playback(spans: Span<MomentSession>[]) {
  const last = spans.length - 1;
  const clamp = (day: number, t: number) =>
    Math.min(spans[day].end - STEP, Math.max(spans[day].start, t));
  const atEnd = ({ day, t }: State) =>
    day === last && t + STEP >= spans[last].end;

  const reducer = (prev: State, a: Action): State => {
    // The days can change under a live schedule; keep the day in range.
    const s = { ...prev, day: Math.min(prev.day, last) };
    switch (a.type) {
      case "tick":
        if (s.t + STEP < spans[s.day].end) return { ...s, t: s.t + STEP };
        if (s.day < last)
          return { ...s, day: s.day + 1, t: spans[s.day + 1].start };
        return { ...s, playing: false };
      case "toggle":
        if (s.playing) return { ...s, playing: false };
        // From the end, play again from the first day.
        return atEnd(s)
          ? { day: 0, t: spans[0].start, playing: true }
          : { ...s, playing: true };
      case "pause":
        return { ...s, playing: false };
      case "seek":
        return { ...s, t: clamp(s.day, a.t) };
      // Same time of day, another day.
      case "day":
        return { ...s, day: a.day, t: clamp(a.day, s.t) };
      case "goto":
        return { day: a.day, t: a.t, playing: false };
    }
  };
  return { reducer, atEnd };
}

// A schedule at any moment: an alternative to the grid. Press play and the
// clock runs fifteen minutes at a time across every day; drag along the day's
// timeline to jump to a moment. The board shows every venue and what was on
// there just then; clicking a session hands it to `onOpen`.
export default function Moments<S extends MomentSession>(props: Props<S>) {
  const spans = useMemo(() => toSpans(props.days), [props.days]);
  if (spans.length === 0) return null;
  return <Board {...props} spans={spans} />;
}

function Board<S extends MomentSession>({
  locations,
  styleFor,
  onOpen,
  legend,
  startAt,
  now,
  hideQuiet = false,
  spans,
}: Props<S> & { spans: Span<S>[] }) {
  const { reducer, atEnd } = useMemo(
    () => playback(spans as Span<MomentSession>[]),
    [spans],
  );
  const [stored, dispatchStored] = useReducer(reducer, null, () => ({
    ...(startAt ?? busiest(spans as Span<MomentSession>[])),
    playing: false,
  }));
  const [following, setFollowing] = useState(true);
  const live = following && now != null;
  const state = live ? { ...now, playing: false } : stored;
  // Moving the clock lets go of the current time, picking up from it.
  const dispatch = (a: Action) => {
    if (live) {
      setFollowing(false);
      dispatchStored({ type: "goto", ...now });
    }
    dispatchStored(a);
  };
  const day = Math.min(state.day, spans.length - 1);
  const { t, playing } = state;

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(
      () => dispatchStored({ type: "tick" }),
      TICK_MS,
    );
    return () => window.clearInterval(id);
  }, [playing]);

  const d = spans[day];
  const running = runningAt(d, t);
  // A tick every two hours, on even clock hours, strictly inside the day.
  const ticks: number[] = [];
  for (let h = Math.ceil(d.start / 120) * 120; h < d.end; h += 120)
    if (h > d.start) ticks.push(h);
  const at = (m: number) => `${((m - d.start) / (d.end - d.start)) * 100}%`;

  const scrub = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - r.left - END_R) / (r.width - 2 * END_R);
    dispatch({
      type: "seek",
      t: d.start + Math.round((frac * (d.end - d.start)) / STEP) * STEP,
    });
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const jump: Record<string, number> = {
      ArrowRight: STEP,
      ArrowUp: STEP,
      ArrowLeft: -STEP,
      ArrowDown: -STEP,
      PageUp: 60,
      PageDown: -60,
      Home: -24 * 60,
      End: 24 * 60,
    };
    if (!(e.key in jump)) return;
    e.preventDefault();
    dispatch({ type: "seek", t: t + jump[e.key] });
  };

  return (
    <div>
      {/* Play on the left, the day in the middle, the clock on the right; on
          a phone the clock takes its own row above. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex items-center gap-2 justify-self-start">
          <button
            type="button"
            onClick={() => dispatch({ type: "toggle" })}
            aria-label={
              playing
                ? "Pause"
                : atEnd({ ...state, day })
                  ? "Play it again"
                  : "Play"
            }
            className="-ml-2 rounded-full p-2 text-navy/45 transition-colors hover:text-navy focus-visible:text-navy"
          >
            {playing ? (
              <Pause aria-hidden className="size-6" fill="currentColor" />
            ) : (
              <Play aria-hidden className="size-6" fill="currentColor" />
            )}
          </button>
          {now && !following && (
            <button
              type="button"
              onClick={() => setFollowing(true)}
              className="rounded-full border-[1.5px] border-meeple px-2.5 py-1 font-space-mono text-[11px] font-bold tracking-[0.12em] text-meeple uppercase transition-colors hover:bg-meeple hover:text-cream"
            >
              Now
            </button>
          )}
        </div>
        <div
          role="group"
          aria-label="Day"
          className="flex divide-x divide-navy/30 border-2 border-navy"
        >
          {spans.map((x, i) => (
            <button
              key={x.name}
              type="button"
              aria-pressed={i === day}
              onClick={() => dispatch({ type: "day", day: i })}
              className={`${DISPLAY} px-3.5 py-2 text-[20px] leading-none tracking-[0.04em] transition-colors sm:px-5 ${
                i === day ? "bg-navy text-cream" : "text-navy hover:bg-sky"
              }`}
            >
              {x.name.slice(0, 3)}
            </button>
          ))}
        </div>
        <p
          className={`${DISPLAY} order-first col-span-3 justify-self-end text-[clamp(30px,4vw,44px)] leading-none text-navy sm:order-none sm:col-span-1`}
        >
          {d.name} · {slotLabel(t)}
        </p>
      </div>

      {/* The day as a timeline, which is also the scrubber: an open circle at
          each end, a tick every two hours, a red line for the current time. */}
      <div className="mt-6">
        <div
          role="slider"
          tabIndex={0}
          aria-label={`Time of day, ${d.name}`}
          aria-valuemin={d.start}
          aria-valuemax={d.end - STEP}
          aria-valuenow={t}
          aria-valuetext={`${d.name} ${slotLabel(t)}, ${running.length} sessions running`}
          onKeyDown={key}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            scrub(e);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) scrub(e);
          }}
          className="relative h-10 cursor-pointer touch-pan-y rounded-md outline-none focus-visible:ring-2 focus-visible:ring-meeple focus-visible:ring-offset-4 focus-visible:ring-offset-background"
        >
          {/* The axis runs between the centres of the two end circles. */}
          <div
            className="absolute inset-y-0"
            style={{ left: END_R, right: END_R }}
          >
            <span
              aria-hidden
              className="absolute top-1/2 right-0 left-0 h-px -translate-y-1/2 bg-ink/30"
            />
            {ticks.map((h) => (
              <span
                key={h}
                aria-hidden
                className="absolute top-1/2 h-2 w-px -translate-x-1/2 -translate-y-1/2 bg-ink/40"
                style={{ left: at(h) }}
              />
            ))}
            {[d.start, d.end].map((m) => (
              <span
                key={m}
                aria-hidden
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-navy bg-background"
                style={{ left: at(m), width: END_R * 2, height: END_R * 2 }}
              />
            ))}
            <span
              aria-hidden
              className="absolute top-1/2 h-7 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-meeple transition-[left] duration-150 ease-out"
              style={{ left: at(t) }}
            />
          </div>
        </div>
        <div
          className="relative h-4 font-space-mono text-[10.5px] text-ink/55"
          style={{ marginLeft: END_R, marginRight: END_R }}
        >
          {ticks.map((h) => (
            <span
              key={h}
              className="absolute -translate-x-1/2 whitespace-nowrap"
              style={{ left: at(h) }}
            >
              {hourLabel(h)}
            </span>
          ))}
        </div>
      </div>

      {legend && (
        <ul className="mt-6 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink/70">
          {legend.map((entry) => (
            <li key={entry.label} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-3.5 rounded-sm border"
                style={entry.style}
              />
              {entry.label}
            </li>
          ))}
        </ul>
      )}

      {hideQuiet && !running.length && (
        <p className="mt-4 font-space-mono text-[11px] tracking-[0.12em] text-ink/35 uppercase">
          Nothing on at this time
        </p>
      )}
      <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
        {(hideQuiet
          ? locations.filter((loc) =>
              running.some((x) => x.s.locationId === loc.id),
            )
          : locations
        ).map((loc) => {
          const here = running.filter((x) => x.s.locationId === loc.id);
          return (
            <li
              key={loc.id}
              className={`flex min-h-[96px] flex-col border-t-2 pt-2 transition-colors duration-300 sm:min-h-[116px] ${
                here.length ? "border-navy" : "border-navy/15"
              }`}
            >
              <h3 className="font-space-mono text-[10.5px] leading-tight font-bold tracking-[0.1em] text-navy uppercase">
                {loc.name}
              </h3>
              <div className="mt-2 flex flex-1 flex-col gap-1.5">
                {here.length ? (
                  here.map(({ s }) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        dispatchStored({ type: "pause" });
                        onOpen(s, d.day);
                      }}
                      style={styleFor(s)}
                      className="rounded-md border-[1.5px] px-2 py-1.5 text-left text-[#1b1530] transition-transform duration-300 hover:-translate-y-0.5 motion-safe:animate-in motion-safe:zoom-in-90 motion-safe:fade-in"
                    >
                      <span className="line-clamp-2 text-[13px] leading-tight font-semibold">
                        {s.title}
                      </span>
                      <span className="mt-0.5 block font-space-mono text-[10px] text-[#1b1530]/75">
                        until {formatPacificTime(s.endsAt)}
                      </span>
                    </button>
                  ))
                ) : (
                  <span className="font-space-mono text-[11px] tracking-[0.12em] text-ink/35 uppercase">
                    Quiet
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
