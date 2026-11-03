import { describe, expect, it } from "vitest";
import {
  CON_START,
  DELETED_PLAYER,
  bucketEnds,
  classTable,
  concentration,
  cumulativeLevels,
  gini,
  lorenzPoints,
  playerKey,
  rankPlayers,
  shareSummary,
  topShare,
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
