import { describe, expect, it } from "vitest";
import {
  CON_START,
  DELETED_PLAYER,
  activeUserIds,
  bucketEnds,
  classTable,
  cohorts,
  computeProgress,
  concentration,
  cumulativeLevels,
  gini,
  levelGridOf,
  lorenzPoints,
  playerKey,
  quantile,
  rankPlayers,
  shareSummary,
  topShare,
  transitions,
  type ProgressCompletion,
  type ProgressLevelEvent,
  type ProgressPlayer,
} from "./megagame-progress";
import { NO_LEVELS } from "./megagame-levels";

const at = (iso: string) => new Date(iso);
const done = (
  userId: string | null,
  cls: string | null,
  iso: string,
): ProgressCompletion => ({ userId, class: cls, confirmedAt: at(iso) });
const ev = (
  userId: string | null,
  cls: string,
  level: number,
  source: "picker" | "volunteer",
  iso: string,
): ProgressLevelEvent => ({
  userId,
  class: cls,
  level,
  source,
  awardedAt: at(iso),
});
const player = (
  id: string,
  levels: Partial<ProgressPlayer["levels"]> = {},
): ProgressPlayer => ({
  id,
  name: id.toUpperCase(),
  levels: { ...NO_LEVELS, ...levels },
});

describe("constants", () => {
  it("starts the con at midnight Pacific on the first con day", () => {
    expect(CON_START.toISOString()).toBe("2026-11-06T08:00:00.000Z");
  });

  it("keys deleted accounts as one pseudo-player", () => {
    expect(playerKey(null)).toBe(DELETED_PLAYER);
    expect(playerKey("u1")).toBe("u1");
  });
});

describe("topShare", () => {
  it("takes ceil(k% of n) players", () => {
    expect(topShare([5, 3, 1, 1], 10)).toBe(0.5);
    expect(topShare([5, 3, 1, 1], 20)).toBe(0.5);
    expect(topShare([5, 3, 1, 1], 50)).toBe(0.8);
  });

  it("does not round 10% of 30 players up to 4", () => {
    expect(topShare(new Array(30).fill(1), 10)).toBe(0.1);
  });

  it("is 0 for no players and 1 for one player", () => {
    expect(topShare([], 20)).toBe(0);
    expect(topShare([4], 10)).toBe(1);
  });
});

describe("gini", () => {
  it("matches the mean-absolute-difference definition", () => {
    expect(gini([1, 3])).toBeCloseTo(0.25, 10);
    expect(gini([1, 1, 2, 4])).toBeCloseTo(0.3125, 10);
    expect(gini([3, 2, 1, 1])).toBeCloseTo(0.25, 10);
  });

  it("is 0 for equal counts and for fewer than two players", () => {
    expect(gini([2, 2, 2, 2])).toBe(0);
    expect(gini([7])).toBe(0);
    expect(gini([])).toBe(0);
  });
});

describe("shareSummary", () => {
  it("reports players, total, the three shares and Gini", () => {
    const s = shareSummary([3, 2, 1, 1]);
    expect(s).toMatchObject({ players: 4, total: 7 });
    expect(s.top10).toBeCloseTo(3 / 7, 10);
    expect(s.top20).toBeCloseTo(3 / 7, 10);
    expect(s.top50).toBeCloseTo(5 / 7, 10);
    expect(s.gini).toBeCloseTo(0.25, 10);
  });

  it("is all zeros when empty", () => {
    expect(shareSummary([])).toEqual({
      players: 0,
      total: 0,
      top10: 0,
      top20: 0,
      top50: 0,
      gini: 0,
    });
  });
});

describe("lorenzPoints", () => {
  it("runs from (0,0) to (1,1) over the ascending counts", () => {
    expect(lorenzPoints([3, 1])).toEqual([
      { x: 0, y: 0 },
      { x: 0.5, y: 0.25 },
      { x: 1, y: 1 },
    ]);
  });

  it("is empty with no counts", () => {
    expect(lorenzPoints([])).toEqual([]);
  });
});

describe("rankPlayers", () => {
  it("sorts by count, then earliest first activity, then key", () => {
    const counts = new Map([
      ["late", 1],
      ["early", 1],
      ["top", 3],
      ["b", 1],
      ["a", 1],
    ]);
    const first = new Map([
      ["late", at("2026-11-06T21:00:00.000Z")],
      ["early", at("2026-11-06T17:00:00.000Z")],
      ["top", at("2026-11-06T22:00:00.000Z")],
      ["b", at("2026-11-06T23:00:00.000Z")],
      ["a", at("2026-11-06T23:00:00.000Z")],
    ]);
    expect(rankPlayers(counts, first)).toEqual([
      "top",
      "early",
      "late",
      "a",
      "b",
    ]);
  });
});

describe("concentration", () => {
  // u1: 3 completions (one any-class), deleted accounts: 2, u2: 1, u3: 1.
  const completions = [
    done("u1", "wizard", "2026-11-06T18:00:00.000Z"),
    done("u1", "wizard", "2026-11-06T19:00:00.000Z"),
    done("u1", null, "2026-11-06T20:00:00.000Z"),
    done("u2", "pirate", "2026-11-06T17:00:00.000Z"),
    done("u3", "wizard", "2026-11-06T21:00:00.000Z"),
    done(null, "wizard", "2026-11-06T22:00:00.000Z"),
    done(null, "pirate", "2026-11-06T23:00:00.000Z"),
  ];
  const levelEvents = [
    ev("u1", "wizard", 2, "volunteer", "2026-11-06T19:30:00.000Z"),
    ev("u1", "wizard", 3, "volunteer", "2026-11-07T19:00:00.000Z"),
    ev("u2", "pirate", 2, "volunteer", "2026-11-07T01:00:00.000Z"),
    ev("u3", "wizard", 1, "picker", "2026-11-06T10:00:00.000Z"),
  ];
  const players = [
    player("u1", { wizard: 3 }),
    player("u2", { pirate: 2 }),
    player("u3", { wizard: 1 }),
  ];
  const ends = [at("2026-11-06T20:00:00.000Z"), at("2026-11-07T00:00:00.000Z")];
  const c = concentration(completions, levelEvents, players, ends);

  it("counts deleted accounts as one player", () => {
    expect(c.completions.players).toBe(4);
    expect(c.completions.total).toBe(7);
    expect(c.completions.top20).toBeCloseTo(3 / 7, 10);
    expect(c.completions.top50).toBeCloseTo(5 / 7, 10);
    expect(c.completions.gini).toBeCloseTo(0.25, 10);
  });

  it("counts any-class completions in overall only", () => {
    expect(c.byClass.wizard).toMatchObject({ players: 3, total: 4 });
    expect(c.byClass.pirate).toMatchObject({ players: 2, total: 2 });
    expect(c.byClass.alien).toMatchObject({ players: 0, total: 0 });
    expect(c.lorenz.overall.at(-1)).toEqual({ x: 1, y: 1 });
    expect(c.lorenz.byClass.wizard).toHaveLength(4);
    expect(c.lorenz.byClass.alien).toEqual([]);
  });

  it("measures level-ups over leveling players, volunteer events only", () => {
    expect(c.levelUps).toMatchObject({ players: 2, total: 3 });
    expect(c.levelUps.top10).toBeCloseTo(2 / 3, 10);
    expect(c.levelUps.gini).toBeCloseTo(1 / 6, 10);
  });

  it("builds the series from events strictly before each end", () => {
    expect(c.series).toHaveLength(2);
    expect(c.series[0]).toMatchObject({ players: 2, completions: 3 });
    expect(c.series[0].top20).toBeCloseTo(2 / 3, 10);
    expect(c.series[0].gini).toBeCloseTo(1 / 6, 10);
    expect(c.series[1]).toMatchObject({ players: 4, completions: 7 });
    expect(c.series[1].top20).toBeCloseTo(3 / 7, 10);
  });

  it("lists the most active players with ties broken by first activity", () => {
    expect(c.mostActive.map((r) => r.key)).toEqual([
      "u1",
      DELETED_PLAYER,
      "u2",
      "u3",
    ]);
    const [u1, deleted] = c.mostActive;
    expect(u1).toMatchObject({
      userId: "u1",
      name: "U1",
      completions: 3,
      byClass: { wizard: 2, pirate: 0, alien: 0 },
      anyClass: 1,
      levelUps: 2,
      levels: { wizard: 3, pirate: 0, alien: 0 },
    });
    expect(u1.firstActivity.toISOString()).toBe("2026-11-06T18:00:00.000Z");
    expect(u1.lastActivity.toISOString()).toBe("2026-11-07T19:00:00.000Z");
    expect(deleted).toMatchObject({
      userId: null,
      name: null,
      levels: NO_LEVELS,
    });
  });

  it("keeps at most 25 rows", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      done(`p${i}`, "alien", "2026-11-06T18:00:00.000Z"),
    );
    expect(concentration(many, [], [], []).mostActive).toHaveLength(25);
  });

  it("handles no data", () => {
    const empty = concentration([], [], [], [at("2026-11-06T20:00:00.000Z")]);
    expect(empty.completions.players).toBe(0);
    expect(empty.lorenz.overall).toEqual([]);
    expect(empty.mostActive).toEqual([]);
    expect(empty.series[0]).toMatchObject({ players: 0, top20: 0, gini: 0 });
  });
});

describe("ignored level events", () => {
  it("skips level events outside 1 to MAX_LEVEL or outside the classes", () => {
    const c = concentration(
      [],
      [
        ev("u1", "wizard", 7, "volunteer", "2026-11-06T18:00:00.000Z"),
        ev("u1", "knight", 2, "volunteer", "2026-11-06T18:00:00.000Z"),
      ],
      [],
      [],
    );
    expect(c.levelUps.total).toBe(0);
  });
});

describe("bucketEnds", () => {
  it("ends each bucket one size later, cut at the range end", () => {
    const ends = bucketEnds(
      [at("2026-11-06T17:00:00.000Z"), at("2026-11-06T18:00:00.000Z")],
      "1h",
      at("2026-11-06T18:30:00.000Z"),
    );
    expect(ends.map((d) => d.toISOString())).toEqual([
      "2026-11-06T18:00:00.000Z",
      "2026-11-06T18:30:00.000Z",
    ]);
  });
});

describe("classTable", () => {
  const completions = [
    done("u2", "pirate", "2026-11-06T17:00:00.000Z"),
    done("u1", "wizard", "2026-11-06T18:00:00.000Z"),
    done("u1", null, "2026-11-06T18:20:00.000Z"),
    done("u1", "wizard", "2026-11-06T19:00:00.000Z"), // after the range end
  ];
  const levelEvents = [
    ev("u3", "wizard", 1, "picker", "2026-11-06T18:10:00.000Z"),
    ev("u1", "wizard", 2, "volunteer", "2026-11-06T18:15:00.000Z"),
  ];
  const players = [
    player("u1", { wizard: 2 }),
    player("u2", { pirate: 1 }),
    player("u3", { wizard: 1 }),
  ];
  const buckets = [
    at("2026-11-06T17:00:00.000Z"),
    at("2026-11-06T18:00:00.000Z"),
  ];
  const ends = [at("2026-11-06T18:00:00.000Z"), at("2026-11-06T18:30:00.000Z")];
  const t = classTable(completions, levelEvents, players, buckets, ends);

  it("counts current members from the level columns", () => {
    expect(t.members).toEqual({ wizard: 2, pirate: 1, alien: 0 });
  });

  it("fills each bucket by class, with any-class completions apart", () => {
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0].byClass).toEqual({
      wizard: { completions: 0, levelUps: 0, activePlayers: 0, memberShare: 0 },
      pirate: { completions: 1, levelUps: 0, activePlayers: 1, memberShare: 1 },
      alien: {
        completions: 0,
        levelUps: 0,
        activePlayers: 0,
        memberShare: null,
      },
    });
    expect(t.rows[0].anyClass).toBe(0);
    // u1 completes and levels up; u3's picker join is not activity: one active wizard of two members.
    expect(t.rows[1].byClass.wizard).toEqual({
      completions: 1,
      levelUps: 1,
      activePlayers: 1,
      memberShare: 0.5,
    });
    expect(t.rows[1].anyClass).toBe(1);
  });

  it("totals sum counts and count distinct players over the range", () => {
    expect(t.totals.byClass.wizard).toEqual({
      completions: 1,
      levelUps: 1,
      activePlayers: 1,
      memberShare: 0.5,
    });
    expect(t.totals.byClass.pirate.completions).toBe(1);
    expect(t.totals.anyClass).toBe(1);
  });

  it("has no rows and zero totals with no buckets", () => {
    const none = classTable(completions, levelEvents, players, [], []);
    expect(none.rows).toEqual([]);
    expect(none.totals.byClass.wizard).toEqual({
      completions: 0,
      levelUps: 0,
      activePlayers: 0,
      memberShare: 0,
    });
  });
});

describe("cumulativeLevels", () => {
  it("counts picker joins as level 1 from their time and drops deleted accounts", () => {
    const levelEvents = [
      ev("u3", "wizard", 1, "picker", "2026-11-06T18:10:00.000Z"),
      ev("u1", "wizard", 2, "volunteer", "2026-11-06T18:15:00.000Z"),
      ev(null, "wizard", 3, "volunteer", "2026-11-06T18:00:00.000Z"),
    ];
    const out = cumulativeLevels(levelEvents, [
      at("2026-11-06T18:12:00.000Z"),
      at("2026-11-06T18:30:00.000Z"),
    ]);
    expect(out[0].wizard).toEqual([0, 1, 0, 0, 0, 0]);
    expect(out[1].wizard).toEqual([0, 1, 1, 0, 0, 0]);
  });
});

const H = 3_600_000;

describe("quantile", () => {
  it("interpolates between closest ranks", () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4], 0.75)).toBe(3.25);
    expect(quantile([5], 0.25)).toBe(5);
    expect(quantile([], 0.5)).toBeNull();
  });
});

describe("transitions", () => {
  const levelEvents = [
    // p1 joined before the con: time at level 1 counts from con start (08:00Z).
    ev("p1", "wizard", 1, "picker", "2026-11-01T12:00:00.000Z"),
    ev("p1", "wizard", 2, "volunteer", "2026-11-06T10:00:00.000Z"),
    ev("p1", "wizard", 3, "volunteer", "2026-11-06T14:00:00.000Z"),
    ev("p2", "wizard", 1, "picker", "2026-11-06T09:00:00.000Z"),
    ev("p2", "wizard", 2, "volunteer", "2026-11-06T13:00:00.000Z"),
    // p3 skips level 2.
    ev("p3", "wizard", 1, "picker", "2026-11-06T09:00:00.000Z"),
    ev("p3", "wizard", 3, "volunteer", "2026-11-06T12:00:00.000Z"),
    ev("p4", "wizard", 1, "picker", "2026-11-06T10:00:00.000Z"),
    ev("p4", "wizard", 2, "volunteer", "2026-11-06T16:00:00.000Z"),
    // Level 2 before level 1: ignored.
    ev("p5", "wizard", 2, "volunteer", "2026-11-06T09:00:00.000Z"),
    ev("p5", "wizard", 1, "picker", "2026-11-06T11:00:00.000Z"),
    // Deleted accounts: ignored.
    ev(null, "wizard", 1, "picker", "2026-11-06T09:00:00.000Z"),
    ev(null, "wizard", 2, "volunteer", "2026-11-06T09:30:00.000Z"),
    ev("p7", "pirate", 1, "picker", "2026-11-01T12:00:00.000Z"),
  ];
  const players = [
    player("p1", { wizard: 3 }),
    player("p2", { wizard: 2 }),
    player("p3", { wizard: 3 }),
    player("p4", { wizard: 2 }),
    player("p6", { wizard: 2 }), // no event behind this level
    player("p7", { pirate: 1 }),
  ];
  const now = at("2026-11-06T20:00:00.000Z");
  const t = transitions(levelEvents, players, now);
  const row = (cls: string, from: number) =>
    t.rows.find((r) => r.class === cls && r.from === from)!;
  const cur = (cls: string, level: number) =>
    t.current.find((r) => r.class === cls && r.level === level)!;

  it("has a row per class and transition, in order", () => {
    expect(t.rows).toHaveLength(12);
    expect(t.rows.slice(0, 4).map((r) => [r.class, r.from, r.to])).toEqual([
      ["wizard", 1, 2],
      ["wizard", 2, 3],
      ["wizard", 3, 4],
      ["wizard", 4, 5],
    ]);
  });

  it("clamps the start to con start and takes quartiles of the made durations", () => {
    expect(row("wizard", 1)).toEqual({
      class: "wizard",
      from: 1,
      to: 2,
      made: 3,
      skipped: 1,
      q25: 3 * H,
      median: 4 * H,
      q75: 5 * H,
    });
    expect(row("wizard", 2)).toMatchObject({
      made: 1,
      skipped: 0,
      median: 4 * H,
    });
  });

  it("leaves empty transitions at zero with null durations", () => {
    expect(row("pirate", 1)).toMatchObject({
      made: 0,
      skipped: 0,
      q25: null,
      median: null,
      q75: null,
    });
  });

  it("counts players at each current level, with the median over those with an event", () => {
    expect(cur("wizard", 2)).toEqual({
      class: "wizard",
      level: 2,
      players: 3,
      withEvent: 2,
      medianSince: 5.5 * H,
    });
    expect(cur("wizard", 3)).toMatchObject({
      players: 2,
      withEvent: 2,
      medianSince: 7 * H,
    });
    expect(cur("wizard", 1)).toMatchObject({
      players: 0,
      withEvent: 0,
      medianSince: null,
    });
    expect(cur("pirate", 1)).toMatchObject({ players: 1, medianSince: 12 * H });
  });

  it("never reports a negative time before the con", () => {
    const early = transitions(
      levelEvents,
      players,
      at("2026-11-02T00:00:00.000Z"),
    );
    expect(
      early.current.find((r) => r.class === "pirate" && r.level === 1)!
        .medianSince,
    ).toBe(0);
  });
});

describe("cohorts", () => {
  const completions = [
    done("A", "wizard", "2026-11-06T20:00:00.000Z"), // Fri 12:00 PT
    done("A", null, "2026-11-07T18:00:00.000Z"), // Sat 10:00 PT
    done("D", "pirate", "2026-11-07T08:00:00.000Z"), // Sat 00:00 PT exactly
    done("D", "pirate", "2026-11-08T19:00:00.000Z"), // Sun 11:00 PT
    done(null, null, "2026-11-06T20:00:00.000Z"), // deleted: no cohort
  ];
  const levelEvents = [
    ev("B", "pirate", 1, "picker", "2026-11-06T09:00:00.000Z"),
    ev("B", "pirate", 2, "volunteer", "2026-11-07T07:30:00.000Z"), // Fri 23:30 PT
    ev("C", "alien", 1, "picker", "2026-11-06T10:00:00.000Z"), // picker only
  ];
  const players = [
    player("A", { wizard: 2 }),
    player("B", { pirate: 2 }),
    player("C", { alien: 1 }),
    player("D", { pirate: 1 }),
  ];
  const t = cohorts(completions, levelEvents, players, ["A", "C", "D", "H"]);
  const day = (key: string) => t.rows.find((r) => r.day === key)!;

  it("has a row per con day and the con days as retention columns", () => {
    expect(t.days).toEqual(["2026-11-06", "2026-11-07", "2026-11-08"]);
    expect(t.rows.map((r) => r.day)).toEqual(t.days);
  });

  it("puts a player in the Pacific day of their first completion or volunteer level-up", () => {
    expect(day("2026-11-06")).toEqual({
      day: "2026-11-06",
      size: 2, // A, and B at 23:30 Friday Pacific
      completionsMean: 1,
      completionsMedian: 1,
      levelUpsMean: 0.5,
      reachedLevel2Share: 1,
      retention: [null, 0.5, 0],
    });
    expect(day("2026-11-07")).toEqual({
      day: "2026-11-07",
      size: 1, // D at midnight Pacific
      completionsMean: 2,
      completionsMedian: 2,
      levelUpsMean: 0,
      reachedLevel2Share: 0,
      retention: [null, null, 1],
    });
  });

  it("leaves an empty cohort with null statistics", () => {
    expect(day("2026-11-08")).toEqual({
      day: "2026-11-08",
      size: 0,
      completionsMean: null,
      completionsMedian: null,
      levelUpsMean: null,
      reachedLevel2Share: null,
      retention: [null, null, null],
    });
  });

  it("counts holders with no activity as not yet active; picker joins do not count", () => {
    expect(t).toMatchObject({
      holders: 4,
      notYetActive: 2,
      notYetActiveShare: 0.5,
    });
  });

  it("adds a row for a day outside the con and gives it every con day as retention", () => {
    const pre = cohorts(
      [done("E", "alien", "2026-11-05T20:00:00.000Z")],
      [],
      [],
      [],
    );
    expect(pre.rows[0]).toMatchObject({
      day: "2026-11-05",
      size: 1,
      retention: [0, 0, 0],
    });
    expect(pre.notYetActiveShare).toBeNull();
  });
});

describe("activeUserIds", () => {
  it("lists distinct real users in first-appearance order", () => {
    expect(
      activeUserIds(
        [
          done("u2", null, "2026-11-06T18:00:00.000Z"),
          done(null, null, "2026-11-06T18:00:00.000Z"),
        ],
        [
          ev("u1", "wizard", 1, "picker", "2026-11-06T09:00:00.000Z"),
          ev("u2", "wizard", 2, "volunteer", "2026-11-06T19:00:00.000Z"),
        ],
      ),
    ).toEqual(["u2", "u1"]);
  });
});

describe("levelGridOf", () => {
  it("counts players per current level in each class, ignoring level 0", () => {
    const grid = levelGridOf([
      player("a", { wizard: 2 }),
      player("b", { wizard: 2, pirate: 1 }),
      player("c", { alien: 5 }),
      player("d"),
    ]);
    expect(grid).toEqual({
      wizard: [0, 0, 2, 0, 0, 0],
      pirate: [0, 1, 0, 0, 0, 0],
      alien: [0, 0, 0, 0, 0, 1],
    });
  });
});

describe("computeProgress", () => {
  it("returns every section for empty input", () => {
    const p = computeProgress({
      completions: [],
      levelEvents: [],
      players: [],
      holderIds: [],
      buckets: [at("2026-11-06T17:00:00.000Z")],
      size: "1h",
      to: at("2026-11-06T17:30:00.000Z"),
      now: at("2026-11-06T17:30:00.000Z"),
    });
    expect(p.ends.map((d) => d.toISOString())).toEqual([
      "2026-11-06T17:30:00.000Z",
    ]);
    expect(p.grid.wizard).toEqual([0, 0, 0, 0, 0, 0]);
    expect(p.concentration.series).toHaveLength(1);
    expect(p.classes.rows).toHaveLength(1);
    expect(p.cumulative).toHaveLength(1);
    expect(p.transitions.rows).toHaveLength(12);
    expect(p.transitions.current).toHaveLength(15);
    expect(p.cohorts.rows.map((r) => r.size)).toEqual([0, 0, 0]);
  });

  it("leaves the bucketed views empty when there are no buckets", () => {
    const p = computeProgress({
      completions: [done("u1", "wizard", "2026-11-06T18:00:00.000Z")],
      levelEvents: [],
      players: [],
      holderIds: [],
      buckets: [],
      size: "5m",
      to: at("2026-11-07T00:00:00.000Z"),
      now: at("2026-11-07T00:00:00.000Z"),
    });
    expect(p.concentration.series).toEqual([]);
    expect(p.classes.rows).toEqual([]);
    expect(p.cumulative).toEqual([]);
    expect(p.concentration.completions.players).toBe(1);
  });
});
