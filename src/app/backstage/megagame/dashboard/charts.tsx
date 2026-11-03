import { polylinePoints, seriesPoints } from "./chart-geometry";
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
          <span>100%</span>
          <span>0%</span>
        </span>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={label}
          className="h-32 w-full border-b border-l border-ink/30"
        >
          {series.map((s) => (
            <polyline
              key={s.name}
              points={polylinePoints(seriesPoints(s.values, 1), W, H)}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            >
              <title>{s.name}</title>
            </polyline>
          ))}
        </svg>
      </div>
      <figcaption className="ml-12 flex justify-between text-xs text-ink/50">
        <span>{first}</span>
        {last !== first && <span>{last}</span>}
      </figcaption>
    </figure>
  );
}
