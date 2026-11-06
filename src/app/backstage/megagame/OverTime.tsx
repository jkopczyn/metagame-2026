import Link from "next/link";
import type { BoardParams } from "./board-params";
import { loadOverTime } from "./data";
import { when } from "./format";
import {
  ANY_CLASS_COLOR,
  CLASS_COLORS,
  Legend,
  StackedBars,
} from "./over-time/charts";
import {
  RANGE_LABELS,
  RANGE_PRESETS,
  overTimeView,
  viewHref,
  type OverTimeView,
} from "./over-time/view";
import Section from "./Section";
import { CLASS_LABELS, MEGAGAME_CLASSES } from "@/lib/megagame-levels";
import { BUCKET_SIZES, type BucketSize } from "@/lib/megagame-rules";
import { PACIFIC } from "@/lib/schedule";

const TABLE = "w-full border-collapse text-sm";
const TH = "border-b border-line px-2 py-1.5 text-left font-semibold text-navy";
const THN = `${TH} text-right`;
const TD = "border-b border-line px-2 py-1.5 align-top";
const TDN = `${TD} text-right tabular-nums`;
const BOX = "overflow-x-auto rounded-xl border border-line bg-white p-2";
const PICK =
  "rounded-full border px-3 py-1 text-sm whitespace-nowrap transition-colors";
const PICK_ON = `${PICK} border-navy bg-navy text-white`;
const PICK_OFF = `${PICK} border-line bg-white text-navy hover:border-navy`;
const NOTE = "text-sm text-ink/60";

const DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC,
  weekday: "short",
  month: "short",
  day: "numeric",
});

const bucketLabel = (at: Date, size: BucketSize) =>
  size === "1d" ? DAY.format(at) : when(at);

const COMPLETION_SERIES = [
  ...MEGAGAME_CLASSES.map((c) => ({
    name: CLASS_LABELS[c],
    color: CLASS_COLORS[c],
  })),
  { name: "Any class", color: ANY_CLASS_COLOR },
];
const CLASS_SERIES = MEGAGAME_CLASSES.map((c) => ({
  name: CLASS_LABELS[c],
  color: CLASS_COLORS[c],
}));

export default async function OverTime({ params }: { params: BoardParams }) {
  const view = overTimeView(params, new Date());
  const rows = await loadOverTime(view);
  return (
    <Section title="Over time">
      <Pickers params={params} view={view} />
      {view.tooMany ? (
        <p role="alert" className="text-sm text-meeple">
          {RANGE_LABELS[view.preset]} in {view.size} buckets is too many rows to
          show. Pick a bigger bucket.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <h3 className="font-semibold text-navy">Quest completions</h3>
            <Legend series={COMPLETION_SERIES} />
            <StackedBars
              label="Quest completions per bucket, by quest class"
              series={COMPLETION_SERIES}
              rows={rows.map((r) => ({
                label: bucketLabel(r.start, view.size),
                values: [
                  ...MEGAGAME_CLASSES.map((c) => r.completions[c]),
                  r.completions.any,
                ],
              }))}
            />
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="font-semibold text-navy">Level-ups</h3>
            <Legend series={CLASS_SERIES} />
            <StackedBars
              label="Volunteer level-ups per bucket, by class"
              series={CLASS_SERIES}
              rows={rows.map((r) => ({
                label: bucketLabel(r.start, view.size),
                values: MEGAGAME_CLASSES.map((c) => r.levelUps[c]),
              }))}
            />
          </div>
          <details className="flex flex-col gap-2">
            <summary className="cursor-pointer font-semibold text-navy">
              Table
            </summary>
            <div className={`${BOX} mt-2`}>
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={TH}>Bucket start</th>
                    <th className={THN}>Completions</th>
                    <th className={THN}>Level-ups</th>
                    <th className={THN}>Joins</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.start.getTime()}>
                      <td className={`${TD} whitespace-nowrap`}>
                        {bucketLabel(r.start, view.size)}
                      </td>
                      <td className={TDN}>{r.completionTotal}</td>
                      <td className={TDN}>{r.levelUpTotal}</td>
                      <td className={TDN}>{r.joinTotal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <p className={NOTE}>
            Times are Pacific. Day buckets start at midnight Pacific standard
            time. Joins are faction picks on the account page. Voided records
            are left out.
          </p>
        </>
      )}
    </Section>
  );
}

function Pickers({
  params,
  view,
}: {
  params: BoardParams;
  view: OverTimeView;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2" aria-label="Range">
        {RANGE_PRESETS.map((p) => (
          <Link
            key={p}
            href={viewHref(params, view, { range: p })}
            replace
            scroll={false}
            className={p === view.preset ? PICK_ON : PICK_OFF}
          >
            {RANGE_LABELS[p]}
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap gap-2" aria-label="Bucket size">
        {BUCKET_SIZES.map((s) => (
          <Link
            key={s}
            href={viewHref(params, view, { bucket: s })}
            replace
            scroll={false}
            className={s === view.size ? PICK_ON : PICK_OFF}
          >
            {s}
          </Link>
        ))}
      </div>
    </div>
  );
}
