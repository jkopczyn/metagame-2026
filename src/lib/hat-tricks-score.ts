// Scoring for the Hat Tricks minigame: 5 points per theft, plus 1, 3, 5, …
// for each shift change the thief holds the hat through.

import { HAT_IDS, type HatId } from "./hat-tricks-hats";
import { shiftChangesBetween, type Schedule } from "./hat-tricks-schedule";

export type Steal = { hatId: HatId; userId: string; stolenAt: Date };
export type Tally = { userId: string; steals: number; points: number };
export type HatScores = { overall: Tally[]; byHat: Record<HatId, Tally[]> };
export type LeaderRow = {
  rank: number;
  userId: string;
  name: string;
  steals: number;
  points: number;
};

export const THEFT_POINTS = 5;
export const DEFAULT_GRACE_MS = 60_000;

const EARLIEST = new Date(-8_640_000_000_000_000);

class TallyBook {
  private readonly rows = new Map<string, Tally>();

  add(userId: string, steals: number, points: number): void {
    const row = this.rows.get(userId);
    if (row) {
      row.steals += steals;
      row.points += points;
      return;
    }
    this.rows.set(userId, { userId, steals, points });
  }

  list(): Tally[] {
    return [...this.rows.values()];
  }
}

/** Points for holding a hat through m changes in one interval: 1 + 3 + … */
function holdingPoints(changes: number): number {
  return changes * changes;
}

function sortedStealsUpTo(
  steals: readonly Steal[],
  hatId: HatId,
  nowMs: number,
): Steal[] {
  return steals
    .filter((s) => s.hatId === hatId && s.stolenAt.getTime() <= nowMs)
    .map((steal, order) => ({ steal, order }))
    .sort(
      (a, b) =>
        a.steal.stolenAt.getTime() - b.steal.stolenAt.getTime() ||
        a.order - b.order,
    )
    .map((entry) => entry.steal);
}

/**
 * The instant each steal is scored from. A steal within graceMs after a shift
 * change is scored from the change, but only the first steal of that hat after
 * it, so effective starts stay in order.
 */
function effectiveStarts(
  hatSteals: readonly Steal[],
  changes: readonly number[],
  graceMs: number,
): number[] {
  return hatSteals.map((steal, index) => {
    const stolenAt = steal.stolenAt.getTime();
    const change = changes.filter((c) => c <= stolenAt).at(-1);
    if (change === undefined || stolenAt - change > graceMs) return stolenAt;
    const previous = hatSteals[index - 1]?.stolenAt.getTime();
    if (previous !== undefined && previous > change) return stolenAt;
    return change;
  });
}

export function scoreHats(
  schedule: Schedule,
  steals: readonly Steal[],
  now: Date,
  options?: { graceMs?: number },
): HatScores {
  const graceMs = options?.graceMs ?? DEFAULT_GRACE_MS;
  const nowMs = now.getTime();
  const changes = shiftChangesBetween(schedule, EARLIEST, now, {
    from: "closed",
    to: "closed",
  }).map((d) => d.getTime());

  const overall = new TallyBook();
  const byHat = {} as Record<HatId, Tally[]>;

  for (const hatId of HAT_IDS) {
    const hatSteals = sortedStealsUpTo(steals, hatId, nowMs);
    const starts = effectiveStarts(hatSteals, changes, graceMs);
    const book = new TallyBook();

    hatSteals.forEach((steal, index) => {
      const from = new Date(starts[index]);
      const isLast = index === hatSteals.length - 1;
      const held = shiftChangesBetween(
        schedule,
        from,
        isLast ? now : new Date(starts[index + 1]),
        isLast
          ? { from: "closed", to: "closed" }
          : { from: "closed", to: "open" },
      ).length;
      const points = THEFT_POINTS + holdingPoints(held);
      book.add(steal.userId, 1, points);
      overall.add(steal.userId, 1, points);
    });

    byHat[hatId] = book.list();
  }

  return { overall: overall.list(), byHat };
}

export function rankTallies(
  tallies: readonly Tally[],
  names: ReadonlyMap<string, string>,
): LeaderRow[] {
  const rows = tallies
    .map((tally) => ({
      ...tally,
      name: names.get(tally.userId) ?? "Unknown",
    }))
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.steals - a.steals ||
        a.name.localeCompare(b.name),
    );

  const ranked: LeaderRow[] = [];
  rows.forEach((row, index) => {
    const previous = ranked[index - 1];
    const tied =
      previous !== undefined &&
      previous.points === row.points &&
      previous.steals === row.steals;
    ranked.push({ rank: tied ? previous.rank : index + 1, ...row });
  });
  return ranked;
}

export function lastSteals(
  steals: readonly Steal[],
  now: Date,
): Map<HatId, Steal> {
  const nowMs = now.getTime();
  const latest = new Map<HatId, Steal>();
  for (const steal of steals) {
    if (steal.stolenAt.getTime() > nowMs) continue;
    const held = latest.get(steal.hatId);
    if (!held || steal.stolenAt.getTime() >= held.stolenAt.getTime()) {
      latest.set(steal.hatId, steal);
    }
  }
  return latest;
}
