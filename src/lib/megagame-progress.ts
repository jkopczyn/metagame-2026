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
import { CONFERENCE_DAYS, fromPacificWall, pacificDayKey } from "./schedule";

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

export type TransitionRow = {
  class: MegagameClass;
  from: number;
  to: number;
  made: number;
  skipped: number;
  /** Durations in milliseconds; null when made is 0. */
  q25: number | null;
  median: number | null;
  q75: number | null;
};

export type CurrentLevelRow = {
  class: MegagameClass;
  level: number;
  players: number;
  withEvent: number;
  /** Milliseconds; null when withEvent is 0. */
  medianSince: number | null;
};

export type Transitions = { rows: TransitionRow[]; current: CurrentLevelRow[] };

export type CohortRow = {
  /** A Pacific day key such as "2026-11-06". */
  day: string;
  size: number;
  completionsMean: number | null;
  completionsMedian: number | null;
  levelUpsMean: number | null;
  reachedLevel2Share: number | null;
  /** One cell per CONFERENCE_DAYS entry; null unless that day is after `day`. */
  retention: (number | null)[];
};

export type CohortTable = {
  /** CONFERENCE_DAYS keys, the retention columns. */
  days: string[];
  rows: CohortRow[];
  holders: number;
  notYetActive: number;
  notYetActiveShare: number | null;
};

export type ProgressInput = {
  completions: readonly ProgressCompletion[];
  levelEvents: readonly ProgressLevelEvent[];
  players: readonly ProgressPlayer[];
  holderIds: readonly string[];
  /** Bucket starts from dashboardView; empty when the range has too many. */
  buckets: readonly Date[];
  size: BucketSize;
  /** The range's exclusive end. */
  to: Date;
  now: Date;
};

export type Progress = {
  ends: Date[];
  /** Players per current level in each class; index = level, index 0 unused. */
  grid: Record<MegagameClass, number[]>;
  concentration: Concentration;
  classes: ClassTable;
  cumulative: Record<MegagameClass, number[]>[];
  transitions: Transitions;
  cohorts: CohortTable;
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

export function quantile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const pos = p * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export const clampToCon = (at: Date): number =>
  Math.max(at.getTime(), CON_START.getTime());

const LEVELS = Array.from({ length: MAX_LEVEL }, (_, i) => i + 1);

/** Earliest live event time per real player and class, by level. */
function levelTimes(
  levelEvents: readonly ProgressLevelEvent[],
): Map<string, Map<number, Date>> {
  const out = new Map<string, Map<number, Date>>();
  for (const e of levelEvents) {
    if (e.userId === null || !isMegagameClass(e.class)) continue;
    if (!inLevelRange(e.level)) continue;
    const key = `${e.class}\u0000${e.userId}`;
    const byLevel = out.get(key) ?? new Map<number, Date>();
    const seen = byLevel.get(e.level);
    if (!seen || e.awardedAt < seen) byLevel.set(e.level, e.awardedAt);
    out.set(key, byLevel);
  }
  return out;
}

export function transitions(
  levelEvents: readonly ProgressLevelEvent[],
  players: readonly ProgressPlayer[],
  now: Date,
): Transitions {
  const times = levelTimes(levelEvents);
  const durations = perClass(() => [0, ...LEVELS].map((): number[] => []));
  const skipped = perClass(() => [0, ...LEVELS].map(() => 0));
  for (const [key, byLevel] of times) {
    const cls = key.split("\u0000")[0] as MegagameClass;
    const levels = [...byLevel.keys()].sort((a, b) => a - b);
    for (let i = 0; i + 1 < levels.length; i++) {
      const a = levels[i];
      const b = levels[i + 1];
      const ta = byLevel.get(a)!;
      const tb = byLevel.get(b)!;
      if (tb < ta) continue;
      if (b === a + 1)
        durations[cls][a].push(Math.max(0, tb.getTime() - clampToCon(ta)));
      else skipped[cls][a]++;
    }
  }

  const rows: TransitionRow[] = MEGAGAME_CLASSES.flatMap((cls) =>
    LEVELS.slice(0, -1).map((from) => {
      const sorted = [...durations[cls][from]].sort((x, y) => x - y);
      return {
        class: cls,
        from,
        to: from + 1,
        made: sorted.length,
        skipped: skipped[cls][from],
        q25: quantile(sorted, 0.25),
        median: quantile(sorted, 0.5),
        q75: quantile(sorted, 0.75),
      };
    }),
  );

  const current: CurrentLevelRow[] = MEGAGAME_CLASSES.flatMap((cls) =>
    LEVELS.map((level) => {
      const at = players.filter((p) => p.levels[cls] === level);
      const since = at
        .flatMap((p) => {
          const t = times.get(`${cls}\u0000${p.id}`)?.get(level);
          return t ? [Math.max(0, now.getTime() - clampToCon(t))] : [];
        })
        .sort((x, y) => x - y);
      return {
        class: cls,
        level,
        players: at.length,
        withEvent: since.length,
        medianSince: quantile(since, 0.5),
      };
    }),
  );

  return { rows, current };
}

const dayOf = (d: Date) => pacificDayKey(d.toISOString());
const mean = (xs: readonly number[]) =>
  xs.length ? sum(xs) / xs.length : null;

export function cohorts(
  completions: readonly ProgressCompletion[],
  levelEvents: readonly ProgressLevelEvent[],
  players: readonly ProgressPlayer[],
  holderIds: readonly string[],
): CohortTable {
  const first = new Map<string, Date>();
  const days = new Map<string, Set<string>>();
  const completed = new Map<string, number>();
  const leveled = new Map<string, number>();
  const touch = (id: string, at: Date) => {
    const f = first.get(id);
    if (!f || at < f) first.set(id, at);
    const set = days.get(id) ?? new Set<string>();
    set.add(dayOf(at));
    days.set(id, set);
  };
  for (const c of completions) {
    if (c.userId === null) continue;
    bump(completed, c.userId);
    touch(c.userId, c.confirmedAt);
  }
  for (const e of levelEvents) {
    if (e.userId === null || !isLevelUp(e) || !isMegagameClass(e.class))
      continue;
    bump(leveled, e.userId);
    touch(e.userId, e.awardedAt);
  }

  const conDays = CONFERENCE_DAYS.map((d) => d.key as string);
  const members = new Map<string, string[]>();
  for (const [id, at] of first) {
    const key = dayOf(at);
    members.set(key, [...(members.get(key) ?? []), id]);
  }
  const levelsOf = new Map(players.map((p) => [p.id, p.levels]));
  const rowDays = [...new Set([...conDays, ...members.keys()])].sort();

  const rows = rowDays.map((day): CohortRow => {
    const ids = members.get(day) ?? [];
    const size = ids.length;
    const share = (n: number) => (size ? n / size : null);
    const comps = ids.map((id) => completed.get(id) ?? 0).sort((a, b) => a - b);
    return {
      day,
      size,
      completionsMean: mean(comps),
      completionsMedian: quantile(comps, 0.5),
      levelUpsMean: mean(ids.map((id) => leveled.get(id) ?? 0)),
      reachedLevel2Share: share(
        ids.filter((id) =>
          MEGAGAME_CLASSES.some((c) => (levelsOf.get(id) ?? NO_LEVELS)[c] >= 2),
        ).length,
      ),
      retention: conDays.map((d) =>
        size && d > day
          ? ids.filter((id) => days.get(id)!.has(d)).length / size
          : null,
      ),
    };
  });

  const holders = new Set(holderIds);
  const notYetActive = [...holders].filter((id) => !first.has(id)).length;
  return {
    days: conDays,
    rows,
    holders: holders.size,
    notYetActive,
    notYetActiveShare: holders.size ? notYetActive / holders.size : null,
  };
}

export function activeUserIds(
  completions: readonly ProgressCompletion[],
  levelEvents: readonly ProgressLevelEvent[],
): string[] {
  const ids = new Set<string>();
  for (const c of completions) if (c.userId) ids.add(c.userId);
  for (const e of levelEvents) if (e.userId) ids.add(e.userId);
  return [...ids];
}

export function levelGridOf(
  players: readonly ProgressPlayer[],
): Record<MegagameClass, number[]> {
  const grid = perClass(() => new Array<number>(MAX_LEVEL + 1).fill(0));
  for (const p of players)
    for (const c of MEGAGAME_CLASSES) {
      const level = p.levels[c];
      if (level >= 1 && level <= MAX_LEVEL) grid[c][level]++;
    }
  return grid;
}

export function computeProgress(input: ProgressInput): Progress {
  const { completions, levelEvents, players, buckets } = input;
  const ends = bucketEnds(buckets, input.size, input.to);
  return {
    ends,
    grid: levelGridOf(players),
    concentration: concentration(completions, levelEvents, players, ends),
    classes: classTable(completions, levelEvents, players, buckets, ends),
    cumulative: cumulativeLevels(levelEvents, ends),
    transitions: transitions(levelEvents, players, input.now),
    cohorts: cohorts(completions, levelEvents, players, input.holderIds),
  };
}
