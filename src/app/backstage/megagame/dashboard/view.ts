import {
  BUCKET_MINUTES,
  bucketSeries,
  bucketStart,
  isBucketSize,
  type BucketSize,
} from "@/lib/megagame-rules";
import {
  CONFERENCE_DAYS,
  PACIFIC,
  fromPacificWall,
  pacificDayKey,
} from "@/lib/schedule";
import { when } from "../format";

export const DASHBOARD = "/backstage/megagame/dashboard";

export const RANGE_PRESETS = ["2h", "today", "con"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const RANGE_LABELS: Record<RangePreset, string> = {
  "2h": "Last 2 hours",
  today: "Today",
  con: "Whole con",
};

const DEFAULT_BUCKET: Record<RangePreset, BucketSize> = {
  "2h": "5m",
  today: "30m",
  con: "3h",
};

/** More rows than this is not readable as a table, so pick a bigger bucket. */
export const MAX_BUCKETS = 300;

const DAY_MS = 24 * 60 * 60 * 1000;

function rangeFor(preset: RangePreset, now: Date): { from: Date; to: Date } {
  if (preset === "2h")
    return { from: new Date(now.getTime() - 2 * 60 * 60 * 1000), to: now };
  if (preset === "today") {
    const key = pacificDayKey(now.toISOString());
    return { from: fromPacificWall(`${key}T00:00`) ?? now, to: now };
  }
  const first = fromPacificWall(`${CONFERENCE_DAYS[0].key}T00:00`)!;
  const last = fromPacificWall(`${CONFERENCE_DAYS.at(-1)!.key}T00:00`)!;
  const end = new Date(last.getTime() + DAY_MS);
  const during = now > first && now < end;
  return { from: first, to: during ? now : end };
}

export type DashboardParams = Record<string, string | string[] | undefined>;

export type DashboardView = {
  preset: RangePreset;
  size: BucketSize;
  /** Whether the bucket came from the URL rather than the range's default. */
  chosenSize: boolean;
  /** The start of the bucket holding the range's start. */
  from: Date;
  /** Exclusive. */
  to: Date;
  buckets: Date[];
  tooMany: boolean;
};

const first = (v: string | string[] | undefined) => [v].flat()[0];

export function dashboardView(sp: DashboardParams, now: Date): DashboardView {
  const range = first(sp.range);
  const preset = RANGE_PRESETS.find((p) => p === range) ?? "today";
  const bucket = first(sp.bucket);
  const chosenSize = isBucketSize(bucket);
  const size = chosenSize ? bucket : DEFAULT_BUCKET[preset];

  const range0 = rangeFor(preset, now);
  const from = bucketStart(range0.from, size);
  const to = range0.to;
  const lastStart = bucketStart(new Date(to.getTime() - 1), size);
  const count =
    (lastStart.getTime() - from.getTime()) / (BUCKET_MINUTES[size] * 60000) + 1;
  const tooMany = count > MAX_BUCKETS;
  const buckets = tooMany
    ? []
    : bucketSeries(from, new Date(to.getTime() - 1), size);
  return { preset, size, chosenSize, from, to, buckets, tooMany };
}

export function viewHref(
  view: DashboardView,
  change: { range?: RangePreset; bucket?: BucketSize },
): string {
  const range = change.range ?? view.preset;
  const params = new URLSearchParams({ range });
  const bucket =
    change.bucket ??
    (change.range === undefined && view.chosenSize ? view.size : undefined);
  if (bucket) params.set("bucket", bucket);
  return `${DASHBOARD}?${params}`;
}

export const EMPTY_RANGE =
  "This range has not started yet, so there are no buckets to show.";

const DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC,
  weekday: "short",
  month: "short",
  day: "numeric",
});

export function formatDuration(ms: number | null): string {
  if (ms === null) return "–";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export const percent = (f: number | null) =>
  f === null ? "–" : `${Math.round(f * 100)}%`;

export const decimal = (n: number | null, digits = 1) =>
  n === null ? "–" : n.toFixed(digits);

export const bucketLabel = (start: Date, size: BucketSize) =>
  size === "1d" ? DAY.format(start) : when(start);

export const endLabel = (end: Date, size: BucketSize) =>
  size === "1d"
    ? `${DAY.format(new Date(end.getTime() - 1))} (end)`
    : when(end);

// A day key is already a Pacific date, so it is formatted at noon UTC in UTC
// to keep that calendar date. The output matches CONFERENCE_DAYS' labels.
export function dayLabel(key: string): string {
  const at = new Date(`${key}T12:00:00.000Z`);
  if (Number.isNaN(at.getTime())) return key;
  const part = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).format(at);
  return `${part({ weekday: "long" })} ${part({ month: "short", day: "numeric" })}`;
}
