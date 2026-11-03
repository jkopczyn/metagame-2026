import { CLASS_COLORS } from "../over-time/charts";
import { polylinePoints, seriesPoints, stackSegments } from "./chart-geometry";
import {
  CLASS_LABELS,
  MAX_LEVEL,
  MEGAGAME_CLASSES,
  type MegagameClass,
} from "@/lib/megagame-levels";
import type { LorenzPoint } from "@/lib/megagame-progress";

export function LorenzPlot({
  label,
  lines,
}: {
  label: string;
  lines: { name: string; color: string; points: LorenzPoint[] }[];
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      role="img"
      aria-label={label}
      className="aspect-square w-64 max-w-full border-b border-l border-ink/30"
    >
      <line
        x1="0"
        y1="100"
        x2="100"
        y2="0"
        stroke="#173059"
        strokeOpacity="0.25"
        strokeDasharray="2 2"
        vectorEffect="non-scaling-stroke"
      />
      {lines
        .filter((l) => l.points.length > 0)
        .map((l) => (
          <polyline
            key={l.name}
            points={polylinePoints(l.points, 100, 100)}
            fill="none"
            stroke={l.color}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          >
            <title>{l.name}</title>
          </polyline>
        ))}
    </svg>
  );
}

const W = 600;
const H = 120;

/** Lines on a fixed 0 to 1 scale; callers render it only when there is at least one point. */
export function LineChart({
  label,
  series,
  first,
  last,
}: {
  label: string;
  series: { name: string; color: string; values: number[] }[];
  first: string;
  last: string;
}) {
  return (
    <figure className="flex flex-col gap-1">
      <div className="flex gap-2">
        <span className="flex w-10 shrink-0 flex-col justify-between text-right text-xs text-ink/50">
          <span>1</span>
          <span>0</span>
        </span>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={label}
          className="h-32 w-full border-b border-l border-ink/30"
        >
          {series.map((s) => {
            const points = seriesPoints(s.values, 1);
            return (
              <g key={s.name}>
                <title>{s.name}</title>
                <polyline
                  points={polylinePoints(points, W, H)}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
                {/* A polyline with one point draws nothing, so mark it. */}
                {points.length === 1 && (
                  <circle
                    cx={points[0].x * W}
                    cy={H - points[0].y * H}
                    r="3"
                    fill={s.color}
                  />
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption className="ml-12 flex justify-between text-xs text-ink/50">
        <span>{first}</span>
        {last !== first && <span>{last}</span>}
      </figcaption>
    </figure>
  );
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/** Per row, one bar per class stacked from level 1 at the bottom; callers render it only when there is at least one row. */
export function ClassLevelBars({
  label,
  rows,
}: {
  label: string;
  rows: { label: string; byClass: Record<MegagameClass, number[]> }[];
}) {
  const max = Math.max(
    1,
    ...rows.flatMap((r) =>
      MEGAGAME_CLASSES.map((c) => sum(r.byClass[c].slice(1))),
    ),
  );
  const slot = W / rows.length;
  const bar = (slot * 0.8) / MEGAGAME_CLASSES.length;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className="h-32 w-full"
    >
      {rows.map((r, i) => (
        <g key={i}>
          <title>{r.label}</title>
          {MEGAGAME_CLASSES.map((c, j) => {
            const counts = r.byClass[c].slice(1);
            const x = i * slot + slot * 0.1 + j * bar;
            return (
              <g key={c}>
                <title>
                  {`${CLASS_LABELS[c]}: ${counts.map((n, k) => `${k + 1}: ${n}`).join(", ")}`}
                </title>
                {stackSegments(counts, max, H).map((seg, k) => (
                  <rect
                    key={k}
                    x={x}
                    y={seg.y}
                    width={bar}
                    height={seg.height}
                    fill={CLASS_COLORS[c]}
                    fillOpacity={0.3 + 0.7 * ((k + 1) / MAX_LEVEL)}
                  />
                ))}
              </g>
            );
          })}
        </g>
      ))}
    </svg>
  );
}
