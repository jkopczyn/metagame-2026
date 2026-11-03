import { isMegagameClass, type MegagameClass } from "@/lib/megagame-levels";
import type { CompletionBucket, LevelEventBucket } from "@/lib/megagame-store";

type PerClass = Record<MegagameClass, number>;

export type SeriesRow = {
  start: Date;
  /** "any" is quests open to every class. */
  completions: PerClass & { any: number };
  completionTotal: number;
  levelUps: PerClass;
  levelUpTotal: number;
  /** Faction picks on /account. */
  joins: PerClass;
  joinTotal: number;
};

const zeros = (): PerClass => ({ wizard: 0, pirate: 0, alien: 0 });

export function fillSeries(
  buckets: readonly Date[],
  completions: readonly CompletionBucket[],
  levelEvents: readonly LevelEventBucket[],
): SeriesRow[] {
  const rows = buckets.map(
    (start): SeriesRow => ({
      start,
      completions: { ...zeros(), any: 0 },
      completionTotal: 0,
      levelUps: zeros(),
      levelUpTotal: 0,
      joins: zeros(),
      joinTotal: 0,
    }),
  );
  const at = new Map(rows.map((r) => [r.start.getTime(), r]));
  for (const c of completions) {
    const row = at.get(c.bucket.getTime());
    if (!row) continue;
    if (c.class === null) row.completions.any += c.n;
    else if (isMegagameClass(c.class)) row.completions[c.class] += c.n;
    else continue;
    row.completionTotal += c.n;
  }
  for (const e of levelEvents) {
    const row = at.get(e.bucket.getTime());
    if (!row || !isMegagameClass(e.class)) continue;
    if (e.source === "picker") {
      row.joins[e.class] += e.n;
      row.joinTotal += e.n;
    } else {
      row.levelUps[e.class] += e.n;
      row.levelUpTotal += e.n;
    }
  }
  return rows;
}
