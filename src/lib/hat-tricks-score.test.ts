import { describe, expect, it } from "vitest";
import {
  lastSteals,
  rankTallies,
  scoreHats,
  type Steal,
  type Tally,
} from "./hat-tricks-score";
import { parseSchedule, type Schedule } from "./hat-tricks-schedule";
import { DECOY_JSON } from "./hat-tricks-decoy.fixture";
import type { HatId } from "./hat-tricks-hats";

const at = (hhmmss: string) => new Date(`2020-01-01T${hhmmss}-08:00`);
const pacific = (iso: string) => new Date(`${iso}-08:00`);

const SCHEDULE: Schedule = parseSchedule(
  JSON.stringify([
    {
      start: "2020-01-01T10:00:00-08:00",
      end: "2020-01-01T11:00:00-08:00",
      hats: ["wizard"],
    },
    {
      start: "2020-01-01T11:00:00-08:00",
      end: "2020-01-01T12:00:00-08:00",
      hats: ["crown"],
    },
    {
      start: "2020-01-01T12:00:00-08:00",
      end: "2020-01-01T13:00:00-08:00",
      hats: ["fuzzy"],
    },
  ]),
);

const NO_GRACE = { graceMs: 0 };

function steal(hatId: HatId, userId: string, stolenAt: Date): Steal {
  return { hatId, userId, stolenAt };
}

function points(tallies: readonly Tally[], userId: string): number {
  return tallies.find((t) => t.userId === userId)?.points ?? 0;
}

function stealCount(tallies: readonly Tally[], userId: string): number {
  return tallies.find((t) => t.userId === userId)?.steals ?? 0;
}

describe("scoreHats", () => {
  it("returns empty tallies when there are no steals", () => {
    const scores = scoreHats(SCHEDULE, [], at("12:30:00"), NO_GRACE);
    expect(scores.overall).toEqual([]);
    for (const rows of Object.values(scores.byHat)) expect(rows).toEqual([]);
  });

  it("gives theft points for a steal with no changes after it", () => {
    const scores = scoreHats(
      SCHEDULE,
      [steal("wizard", "a", at("10:30:00"))],
      at("10:45:00"),
      NO_GRACE,
    );
    expect(scores.overall).toEqual([{ userId: "a", steals: 1, points: 5 }]);
  });

  it("gives 1, 3, 5 for three changes held through", () => {
    const scores = scoreHats(
      SCHEDULE,
      [steal("wizard", "a", at("09:30:00"))],
      at("12:30:00"),
      NO_GRACE,
    );
    expect(points(scores.overall, "a")).toBe(14);
  });

  it("restarts the streak when the hat changes hands and comes back", () => {
    const scores = scoreHats(
      SCHEDULE,
      [
        steal("wizard", "a", at("09:30:00")),
        steal("wizard", "b", at("10:30:00")),
        steal("wizard", "a", at("11:30:00")),
      ],
      at("12:30:00"),
      NO_GRACE,
    );
    expect(points(scores.overall, "a")).toBe(12);
    expect(stealCount(scores.overall, "a")).toBe(2);
    expect(points(scores.overall, "b")).toBe(6);
  });

  it("gives a change at the instant of a steal to the new thief", () => {
    const scores = scoreHats(
      SCHEDULE,
      [
        steal("wizard", "a", at("09:30:00")),
        steal("wizard", "b", at("11:00:00")),
      ],
      at("11:30:00"),
      NO_GRACE,
    );
    expect(points(scores.overall, "a")).toBe(6);
    expect(points(scores.overall, "b")).toBe(6);
  });

  it("counts a change at exactly now for the current holder", () => {
    const scores = scoreHats(
      SCHEDULE,
      [steal("wizard", "a", at("10:30:00"))],
      at("11:00:00"),
      NO_GRACE,
    );
    expect(points(scores.overall, "a")).toBe(6);
  });

  it("never counts one change for two holders", () => {
    const scores = scoreHats(
      SCHEDULE,
      [
        steal("wizard", "a", at("10:30:00")),
        steal("wizard", "b", at("11:00:00")),
      ],
      at("11:00:00"),
      NO_GRACE,
    );
    expect(points(scores.overall, "a")).toBe(5);
    expect(points(scores.overall, "b")).toBe(6);
  });

  it("keeps two hats separate per hat and summed overall", () => {
    const scores = scoreHats(
      SCHEDULE,
      [
        steal("wizard", "a", at("09:30:00")),
        steal("crown", "a", at("09:30:00")),
      ],
      at("11:30:00"),
      NO_GRACE,
    );
    expect(scores.byHat.wizard).toEqual([
      { userId: "a", steals: 1, points: 9 },
    ]);
    expect(scores.byHat.crown).toEqual([{ userId: "a", steals: 1, points: 9 }]);
    expect(scores.overall).toEqual([{ userId: "a", steals: 2, points: 18 }]);
  });

  it("ignores steals after now", () => {
    const scores = scoreHats(
      SCHEDULE,
      [steal("wizard", "a", at("12:30:00"))],
      at("11:30:00"),
      NO_GRACE,
    );
    expect(scores.overall).toEqual([]);
  });

  it("scores a steal inside the grace window from the shift change", () => {
    const steals = [
      steal("wizard", "a", at("09:30:00")),
      steal("wizard", "b", at("11:00:30")),
    ];
    const graced = scoreHats(SCHEDULE, steals, at("11:30:00"));
    expect(points(graced.overall, "a")).toBe(6);
    expect(points(graced.overall, "b")).toBe(6);

    const late = scoreHats(
      SCHEDULE,
      [steals[0], steal("wizard", "b", at("11:01:30"))],
      at("11:30:00"),
    );
    expect(points(late.overall, "a")).toBe(9);
    expect(points(late.overall, "b")).toBe(5);

    const off = scoreHats(SCHEDULE, steals, at("11:30:00"), NO_GRACE);
    expect(points(off.overall, "a")).toBe(9);
    expect(points(off.overall, "b")).toBe(5);
  });

  it("moves only the first steal of a hat back to a change", () => {
    const scores = scoreHats(
      SCHEDULE,
      [
        steal("wizard", "a", at("09:30:00")),
        steal("wizard", "b", at("11:00:20")),
        steal("wizard", "c", at("11:00:40")),
      ],
      at("11:30:00"),
    );
    expect(points(scores.overall, "a")).toBe(6);
    expect(points(scores.overall, "b")).toBe(6);
    expect(points(scores.overall, "c")).toBe(5);
  });
});

describe("rankTallies", () => {
  const names = new Map([
    ["a", "Ada"],
    ["b", "Bo"],
    ["c", "Cy"],
  ]);

  it("orders by points, then steals, then name", () => {
    const rows = rankTallies(
      [
        { userId: "a", steals: 1, points: 5 },
        { userId: "b", steals: 2, points: 10 },
        { userId: "c", steals: 3, points: 5 },
      ],
      names,
    );
    expect(rows.map((r) => r.userId)).toEqual(["b", "c", "a"]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("shares a rank on equal points and steals, then skips to the position", () => {
    const rows = rankTallies(
      [
        { userId: "a", steals: 1, points: 5 },
        { userId: "b", steals: 1, points: 5 },
        { userId: "c", steals: 1, points: 1 },
      ],
      names,
    );
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 3]);
    expect(rows.map((r) => r.name)).toEqual(["Ada", "Bo", "Cy"]);
  });

  it("falls back to Unknown for a missing name", () => {
    const rows = rankTallies(
      [{ userId: "zz", steals: 1, points: 5 }],
      new Map(),
    );
    expect(rows[0].name).toBe("Unknown");
  });
});

describe("lastSteals", () => {
  it("takes the latest steal per hat, ignoring the future", () => {
    const result = lastSteals(
      [
        steal("wizard", "a", at("10:00:00")),
        steal("wizard", "b", at("10:30:00")),
        steal("crown", "c", at("12:30:00")),
      ],
      at("11:30:00"),
    );
    expect(result.get("wizard")?.userId).toBe("b");
    expect(result.has("crown")).toBe(false);
    expect(result.has("fuzzy")).toBe(false);
  });

  it("breaks ties by input order and keeps the recorded time", () => {
    const result = lastSteals(
      [
        steal("wizard", "a", at("11:00:30")),
        steal("wizard", "b", at("11:00:30")),
      ],
      at("11:30:00"),
    );
    expect(result.get("wizard")?.userId).toBe("b");
    expect(result.get("wizard")?.stolenAt).toEqual(at("11:00:30"));
  });
});

describe("the decoy weekend", () => {
  const schedule = parseSchedule(DECOY_JSON);

  it("scores a Friday steal through four changes", () => {
    const scores = scoreHats(
      schedule,
      [steal("wizard", "a", pacific("2020-01-03T15:00:00"))],
      pacific("2020-01-04T09:00:00"),
    );
    expect(points(scores.overall, "a")).toBe(21);
  });

  it("scores a Sunday steal through the 20-minute shifts", () => {
    const scores = scoreHats(
      schedule,
      [steal("crown", "b", pacific("2020-01-05T09:05:00"))],
      pacific("2020-01-05T10:00:00"),
    );
    expect(points(scores.overall, "b")).toBe(14);
  });

  it("sums both thieves in the overall table", () => {
    const scores = scoreHats(
      schedule,
      [
        steal("wizard", "a", pacific("2020-01-03T15:00:00")),
        steal("crown", "b", pacific("2020-01-05T09:05:00")),
      ],
      pacific("2020-01-05T10:00:00"),
    );
    expect(scores.overall.map((t) => t.userId).sort()).toEqual(["a", "b"]);
  });
});
