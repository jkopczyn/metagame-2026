import { boardHref, type BoardParams } from "../board-params";
import {
  BUCKET_MINUTES,
  bucketSeries,
  bucketStart,
  isBucketSize,
  type BucketSize,
} from "@/lib/megagame-rules";
import {
  CONFERENCE_DAYS,
  fromPacificWall,
  pacificDayKey,
} from "@/lib/schedule";

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

export type OverTimeView = {
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

export function overTimeView(
  { range, bucket }: Pick<BoardParams, "range" | "bucket">,
  now: Date,
): OverTimeView {
  const preset = RANGE_PRESETS.find((p) => p === range) ?? "today";
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

/** The board's other choices stay; a new range drops a chosen bucket for its own default. */
export function viewHref(
  params: BoardParams,
  view: OverTimeView,
  change: { range?: RangePreset; bucket?: BucketSize },
): string {
  const bucket =
    change.bucket ??
    (change.range === undefined && view.chosenSize ? view.size : null);
  return boardHref({
    ...params,
    range: change.range ?? view.preset,
    bucket,
  });
}
