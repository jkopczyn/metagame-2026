// Pure computations for the megagame progress dashboard: concentration,
// classes, level transitions and cohorts. No database imports; the page
// loads live rows through megagame-store.ts and passes them in.

import {
  MAX_LEVEL,
  MEGAGAME_CLASSES,
  NO_LEVELS,
  isMegagameClass,
  type MegagameClass,
  type MegagameLevels,
} from "./megagame-levels";
import {
  BUCKET_MINUTES,
  cumulativeLevelDistribution,
  type BucketSize,
  type DatedLevelEvent,
} from "./megagame-rules";
import { CONFERENCE_DAYS, fromPacificWall } from "./schedule";

export type ProgressCompletion = {
  userId: string | null;
  /** The quest's class; null for an any-class quest. */
  class: string | null;
  confirmedAt: Date;
};

export type ProgressLevelEvent = {
  userId: string | null;
  class: string;
  level: number;
  /** "picker" or "volunteer". */
  source: string;
  awardedAt: Date;
};

export type ProgressPlayer = {
  id: string;
  name: string;
  /** The user table's level columns. */
  levels: MegagameLevels;
};

export type ShareSummary = {
  players: number;
  total: number;
  /** Shares are fractions in [0, 1]. */
  top10: number;
  top20: number;
  top50: number;
  gini: number;
};

export type LorenzPoint = { x: number; y: number };

export type ConcentrationPoint = {
  end: Date;
  players: number;
  completions: number;
  top20: number;
  gini: number;
};

export type ActivePlayerRow = {
  key: string;
  userId: string | null;
  /** null for the deleted-accounts pseudo-player or an id with no user row. */
  name: string | null;
  levels: MegagameLevels;
  completions: number;
  byClass: Record<MegagameClass, number>;
  anyClass: number;
  levelUps: number;
  firstActivity: Date;
  lastActivity: Date;
};

export type Concentration = {
  completions: ShareSummary;
  byClass: Record<MegagameClass, ShareSummary>;
  levelUps: ShareSummary;
  lorenz: {
    overall: LorenzPoint[];
    byClass: Record<MegagameClass, LorenzPoint[]>;
  };
  series: ConcentrationPoint[];
  mostActive: ActivePlayerRow[];
};

export type ClassCell = {
  completions: number;
  levelUps: number;
  activePlayers: number;
  /** activePlayers / current members; null when the class has no members. */
  memberShare: number | null;
};

export type ClassRow = {
  start: Date;
  end: Date;
  byClass: Record<MegagameClass, ClassCell>;
  anyClass: number;
};

export type ClassTable = {
  members: Record<MegagameClass, number>;
  rows: ClassRow[];
  totals: { byClass: Record<MegagameClass, ClassCell>; anyClass: number };
};

export const DELETED_PLAYER = "\u0000deleted";
export const playerKey = (userId: string | null): string =>
  userId ?? DELETED_PLAYER;

export const CON_START: Date = fromPacificWall(
  `${CONFERENCE_DAYS[0].key}T00:00`,
)!;

export const SHARE_PERCENTS = [10, 20, 50] as const;
export const MOST_ACTIVE_LIMIT = 25;

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

const perClass = <T>(make: () => T): Record<MegagameClass, T> =>
  Object.fromEntries(MEGAGAME_CLASSES.map((c) => [c, make()])) as Record<
    MegagameClass,
    T
  >;

/** The class a completion counts toward, or null for any-class. */
const questClass = (cls: string | null): MegagameClass | null =>
  isMegagameClass(cls) ? cls : null;

const inLevelRange = (level: number) =>
  Number.isInteger(level) && level >= 1 && level <= MAX_LEVEL;

const isLevelUp = (e: ProgressLevelEvent) =>
  e.source === "volunteer" && inLevelRange(e.level);

export function topShare(counts: readonly number[], percent: number): number {
  const total = sum(counts);
  if (counts.length === 0 || total === 0) return 0;
  const m = Math.ceil((percent * counts.length) / 100);
  const top = [...counts].sort((a, b) => b - a).slice(0, m);
  return sum(top) / total;
}

export function gini(counts: readonly number[]): number {
  const n = counts.length;
  const total = sum(counts);
  if (n < 2 || total === 0) return 0;
  const sorted = [...counts].sort((a, b) => a - b);
  let weighted = 0;
  sorted.forEach((x, i) => (weighted += (i + 1) * x));
  return (2 * weighted) / (n * total) - (n + 1) / n;
}

export function shareSummary(counts: readonly number[]): ShareSummary {
  return {
    players: counts.length,
    total: sum(counts),
    top10: topShare(counts, 10),
    top20: topShare(counts, 20),
    top50: topShare(counts, 50),
    gini: gini(counts),
  };
}

export function lorenzPoints(counts: readonly number[]): LorenzPoint[] {
  const total = sum(counts);
  if (counts.length === 0 || total === 0) return [];
  const sorted = [...counts].sort((a, b) => a - b);
  const out: LorenzPoint[] = [{ x: 0, y: 0 }];
  let running = 0;
  sorted.forEach((c, i) => {
    running += c;
    out.push({ x: (i + 1) / sorted.length, y: running / total });
  });
  return out;
}

const LATEST = Number.MAX_SAFE_INTEGER;

export function rankPlayers(
  counts: ReadonlyMap<string, number>,
  firstActivity: ReadonlyMap<string, Date>,
): string[] {
  const first = (k: string) => firstActivity.get(k)?.getTime() ?? LATEST;
  return [...counts.keys()].sort(
    (a, b) =>
      counts.get(b)! - counts.get(a)! ||
      first(a) - first(b) ||
      (a < b ? -1 : a > b ? 1 : 0),
  );
}

function bump(map: Map<string, number>, key: string, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

const perClassFrom = <T>(f: (cls: MegagameClass) => T) =>
  Object.fromEntries(MEGAGAME_CLASSES.map((c) => [c, f(c)])) as Record<
    MegagameClass,
    T
  >;

function widen(
  first: Map<string, Date>,
  last: Map<string, Date>,
  key: string,
  at: Date,
) {
  const f = first.get(key);
  if (!f || at < f) first.set(key, at);
  const l = last.get(key);
  if (!l || at > l) last.set(key, at);
}

export function concentration(
  completions: readonly ProgressCompletion[],
  levelEvents: readonly ProgressLevelEvent[],
  players: readonly ProgressPlayer[],
  ends: readonly Date[],
): Concentration {
  const overall = new Map<string, number>();
  const byClass = perClass(() => new Map<string, number>());
  const anyClass = new Map<string, number>();
  const levelUps = new Map<string, number>();
  const first = new Map<string, Date>();
  const last = new Map<string, Date>();

  for (const c of completions) {
    const key = playerKey(c.userId);
    bump(overall, key);
    const cls = questClass(c.class);
    if (cls) bump(byClass[cls], key);
    else bump(anyClass, key);
    widen(first, last, key, c.confirmedAt);
  }
  for (const e of levelEvents) {
    if (!isLevelUp(e) || !isMegagameClass(e.class)) continue;
    const key = playerKey(e.userId);
    bump(levelUps, key);
    widen(first, last, key, e.awardedAt);
  }

  const byId = new Map(players.map((p) => [p.id, p]));
  const mostActive = rankPlayers(overall, first)
    .slice(0, MOST_ACTIVE_LIMIT)
    .map((key): ActivePlayerRow => {
      const userId = key === DELETED_PLAYER ? null : key;
      const p = userId ? byId.get(userId) : undefined;
      return {
        key,
        userId,
        name: p?.name ?? null,
        levels: p?.levels ?? NO_LEVELS,
        completions: overall.get(key) ?? 0,
        byClass: perClassFrom((cls) => byClass[cls].get(key) ?? 0),
        anyClass: anyClass.get(key) ?? 0,
        levelUps: levelUps.get(key) ?? 0,
        firstActivity: first.get(key)!,
        lastActivity: last.get(key)!,
      };
    });

  const series = ends.map((end): ConcentrationPoint => {
    const counts = new Map<string, number>();
    for (const c of completions)
      if (c.confirmedAt < end) bump(counts, playerKey(c.userId));
    const values = [...counts.values()];
    return {
      end,
      players: values.length,
      completions: sum(values),
      top20: topShare(values, 20),
      gini: gini(values),
    };
  });

  return {
    completions: shareSummary([...overall.values()]),
    byClass: perClassFrom((cls) => shareSummary([...byClass[cls].values()])),
    levelUps: shareSummary([...levelUps.values()]),
    lorenz: {
      overall: lorenzPoints([...overall.values()]),
      byClass: perClassFrom((cls) => lorenzPoints([...byClass[cls].values()])),
    },
    series,
    mostActive,
  };
}

export function bucketEnds(
  buckets: readonly Date[],
  size: BucketSize,
  to: Date,
): Date[] {
  const step = BUCKET_MINUTES[size] * 60_000;
  return buckets.map(
    (b) => new Date(Math.min(b.getTime() + step, to.getTime())),
  );
}

function classCells(
  completions: readonly ProgressCompletion[],
  levelEvents: readonly ProgressLevelEvent[],
  members: Record<MegagameClass, number>,
  start: number,
  end: number,
): { byClass: Record<MegagameClass, ClassCell>; anyClass: number } {
  const inWindow = (d: Date) => d.getTime() >= start && d.getTime() < end;
  const counts = perClass(() => ({ completions: 0, levelUps: 0 }));
  const active = perClass(() => new Set<string>());
  let anyClass = 0;
  for (const c of completions) {
    if (!inWindow(c.confirmedAt)) continue;
    const cls = questClass(c.class);
    if (!cls) {
      anyClass++;
      continue;
    }
    counts[cls].completions++;
    active[cls].add(playerKey(c.userId));
  }
  for (const e of levelEvents) {
    if (!inWindow(e.awardedAt) || !isLevelUp(e) || !isMegagameClass(e.class))
      continue;
    counts[e.class].levelUps++;
    active[e.class].add(playerKey(e.userId));
  }
  return {
    byClass: perClassFrom((cls) => ({
      ...counts[cls],
      activePlayers: active[cls].size,
      memberShare: members[cls] > 0 ? active[cls].size / members[cls] : null,
    })),
    anyClass,
  };
}

export function classTable(
  completions: readonly ProgressCompletion[],
  levelEvents: readonly ProgressLevelEvent[],
  players: readonly ProgressPlayer[],
  buckets: readonly Date[],
  ends: readonly Date[],
): ClassTable {
  const members = perClassFrom(
    (cls) => players.filter((p) => p.levels[cls] >= 1).length,
  );
  const rows = buckets.map(
    (start, i): ClassRow => ({
      start,
      end: ends[i],
      ...classCells(
        completions,
        levelEvents,
        members,
        start.getTime(),
        ends[i].getTime(),
      ),
    }),
  );
  const totals =
    buckets.length === 0
      ? classCells([], [], members, 0, 0)
      : classCells(
          completions,
          levelEvents,
          members,
          buckets[0].getTime(),
          ends.at(-1)!.getTime(),
        );
  return { members, rows, totals };
}

export function cumulativeLevels(
  levelEvents: readonly ProgressLevelEvent[],
  ends: readonly Date[],
): Record<MegagameClass, number[]>[] {
  const dated: DatedLevelEvent[] = levelEvents.flatMap((e) =>
    e.userId === null
      ? []
      : [
          {
            userId: e.userId,
            class: e.class,
            level: e.level,
            awardedAt: e.awardedAt,
          },
        ],
  );
  return cumulativeLevelDistribution(dated, ends);
}
