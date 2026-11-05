export type Point = { x: number; y: number };

const r2 = (v: number) => Math.round(v * 100) / 100;

export function polylinePoints(
  points: readonly Point[],
  width: number,
  height: number,
): string {
  return points
    .map((p) => `${r2(p.x * width)},${r2(height - p.y * height)}`)
    .join(" ");
}

export function seriesPoints(values: readonly number[], max: number): Point[] {
  const n = values.length;
  return values.map((v, i) => ({
    x: n === 1 ? 0.5 : i / (n - 1),
    y: max > 0 ? v / max : 0,
  }));
}

export function stackSegments(
  values: readonly number[],
  max: number,
  height: number,
): { y: number; height: number }[] {
  let top = height;
  return values.map((v) => {
    const h = max > 0 ? (v / max) * height : 0;
    top -= h;
    return { y: top, height: h };
  });
}
