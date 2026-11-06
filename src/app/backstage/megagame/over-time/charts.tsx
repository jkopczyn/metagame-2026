import type { MegagameClass } from "@/lib/megagame-levels";

// Lighter than the faction emblem colors so all three sit in one lightness
// band; the table carries every number, so color is never the only key.
export const CLASS_COLORS: Record<MegagameClass, string> = {
  wizard: "#5A2FD0",
  pirate: "#B8AA00",
  alien: "#00B891",
};
export const ANY_CLASS_COLOR = "#8C8C8C";

export type Series = { name: string; color: string };

export function Legend({ series }: { series: readonly Series[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink/70">
      {series.map((s) => (
        <li key={s.name} className="flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden="true">
            <rect width="10" height="10" rx="2" fill={s.color} />
          </svg>
          {s.name}
        </li>
      ))}
    </ul>
  );
}

const W = 600;
const H = 120;

/** Vertical stacked bars, one per row; hover a bar for its numbers. */
export function StackedBars({
  label,
  series,
  rows,
}: {
  label: string;
  series: readonly Series[];
  rows: readonly { label: string; values: readonly number[] }[];
}) {
  const max = Math.max(
    1,
    ...rows.map((r) => r.values.reduce((a, b) => a + b, 0)),
  );
  const slot = W / Math.max(rows.length, 1);
  const gap = slot > 6 ? 2 : 0;
  return (
    <figure className="flex flex-col gap-1">
      <div className="flex gap-2">
        <span className="flex w-8 shrink-0 flex-col justify-between text-right text-xs text-ink/50">
          <span>{max}</span>
          <span>0</span>
        </span>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={label}
          className="h-32 w-full border-b border-ink/30"
        >
          {rows.map((r, i) => {
            let y = H;
            const total = r.values.reduce((a, b) => a + b, 0);
            const tip = [
              r.label,
              ...series.map((s, j) => `${s.name}: ${r.values[j]}`),
            ].join("\n");
            return (
              <g key={i}>
                <title>{tip}</title>
                <rect
                  x={i * slot}
                  y={0}
                  width={slot}
                  height={H}
                  fill="transparent"
                />
                {total > 0 &&
                  r.values.map((v, j) => {
                    if (v === 0) return null;
                    const h = (v / max) * H;
                    y -= h;
                    return (
                      <rect
                        key={j}
                        x={i * slot + gap / 2}
                        y={y}
                        width={slot - gap}
                        height={Math.max(h - 1, 0.5)}
                        fill={series[j].color}
                      />
                    );
                  })}
              </g>
            );
          })}
        </svg>
      </div>
      {rows.length > 0 && (
        <figcaption className="ml-10 flex justify-between text-xs text-ink/50">
          <span>{rows[0].label}</span>
          {rows.length > 1 && <span>{rows.at(-1)!.label}</span>}
        </figcaption>
      )}
    </figure>
  );
}
