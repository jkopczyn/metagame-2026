import { describe, expect, it } from "vitest";
import { MAX_LEVEL, NO_LEVELS } from "./megagame-levels";
import {
  BUCKET_MINUTES,
  BUCKET_ORIGIN,
  BUCKET_SIZES,
  bucketIntervalSql,
  bucketSeries,
  bucketStart,
  checkLevelUp,
  checkQuestWindow,
  playerQuestStatus,
  questWindowIsValid,
  isCompleteMegagameCode,
  matchAnswer,
  normalizeAnswer,
  isBucketSize,
  normalizeMegagameCode,
  normalizeBadgeNumber,
  parseScannedCode,
  type BucketSize,
} from "./megagame-rules";

describe("normalizeMegagameCode", () => {
  it("drops separators and uppercases", () => {
    expect(normalizeMegagameCode("a2c-4ef")).toBe("A2C4EF");
    expect(normalizeMegagameCode("a2c 4ef")).toBe("A2C4EF");
    expect(normalizeMegagameCode("A2C4EF")).toBe("A2C4EF");
  });

  it("folds the Crockford lookalikes the same way ticket codes do", () => {
    expect(normalizeMegagameCode("ilou12")).toBe("110V12");
  });

  it("takes the code out of a pasted QR URL", () => {
    expect(normalizeMegagameCode("https://metagame.games/q/A2C-4EF")).toBe(
      "A2C4EF",
    );
    expect(
      normalizeMegagameCode("https://metagame.games/q/A2C-4EF?utm_source=x"),
    ).toBe("A2C4EF");
    expect(normalizeMegagameCode("https://metagame.games/q/A2C-4EF/")).toBe(
      "A2C4EF",
    );
    expect(normalizeMegagameCode("https://metagame.games/q/A2C-4EF#top")).toBe(
      "A2C4EF",
    );
  });

  it("does not truncate over-long input", () => {
    expect(normalizeMegagameCode("A2C4EFGH")).toBe("A2C4EFGH");
    expect(isCompleteMegagameCode("A2C4EFGH")).toBe(false);
  });

  it("handles empty input", () => {
    expect(normalizeMegagameCode("")).toBe("");
    expect(isCompleteMegagameCode("")).toBe(false);
  });
});

describe("normalizeBadgeNumber", () => {
  it("reads one to four digits, with or without leading zeros", () => {
    expect(normalizeBadgeNumber("0042")).toBe(42);
    expect(normalizeBadgeNumber("42")).toBe(42);
    expect(normalizeBadgeNumber("0")).toBe(0);
    expect(normalizeBadgeNumber("0000")).toBe(0);
    expect(normalizeBadgeNumber("9999")).toBe(9999);
  });

  it("ignores whitespace", () => {
    expect(normalizeBadgeNumber(" 00 42 ")).toBe(42);
  });

  it("refuses anything else", () => {
    expect(normalizeBadgeNumber("")).toBeNull();
    expect(normalizeBadgeNumber("10000")).toBeNull();
    expect(normalizeBadgeNumber("00042")).toBeNull();
    expect(normalizeBadgeNumber("-1")).toBeNull();
    expect(normalizeBadgeNumber("4.2")).toBeNull();
    expect(normalizeBadgeNumber("A2C4EF")).toBeNull();
    expect(normalizeBadgeNumber("https://metagame.games/p/0042")).toBeNull();
  });
});

describe("parseScannedCode", () => {
  it("reads a quest label URL", () => {
    expect(parseScannedCode("https://metagame.games/q/A2C-4EF")).toEqual({
      kind: "quest",
      code: "A2C4EF",
    });
  });

  it("reads a quest URL from any host, ignoring query, hash and a trailing slash", () => {
    expect(
      parseScannedCode("https://preview.vercel.app/q/a2c4ef/?x=1#y"),
    ).toEqual({ kind: "quest", code: "A2C4EF" });
  });

  it("reads the tool's own quest URL", () => {
    expect(
      parseScannedCode("https://metagame.games/backstage/megagame/q/A2C4EF"),
    ).toEqual({ kind: "quest", code: "A2C4EF" });
  });

  it("reads a bare six-character code as a quest", () => {
    expect(parseScannedCode(" a2c-4ef ")).toEqual({
      kind: "quest",
      code: "A2C4EF",
    });
  });

  it("reads a bare four-digit badge number as a player", () => {
    expect(parseScannedCode("0042")).toEqual({
      kind: "player",
      badgeNumber: 42,
    });
    expect(parseScannedCode(" 9999 ")).toEqual({
      kind: "player",
      badgeNumber: 9999,
    });
  });

  it("wants all four digits on a badge", () => {
    expect(parseScannedCode("42")).toBeNull();
    expect(parseScannedCode("00042")).toBeNull();
  });

  it("refuses an incomplete or over-long code", () => {
    expect(parseScannedCode("https://metagame.games/q/A2C4E")).toBeNull();
    expect(parseScannedCode("A2C4EFG")).toBeNull();
  });

  it("refuses URLs and text that are not quest codes or badge numbers", () => {
    expect(parseScannedCode("https://metagame.games/p/A2C4EF")).toBeNull();
    expect(parseScannedCode("https://metagame.games/p/0042")).toBeNull();
    expect(parseScannedCode("https://example.com/menu")).toBeNull();
    expect(parseScannedCode("https://example.com/x/A2C4EF")).toBeNull();
    expect(parseScannedCode("https://example.com/")).toBeNull();
    expect(parseScannedCode("WIFI:S:Hall;T:WPA;P:abc;;")).toBeNull();
    expect(parseScannedCode("Hi, Ada!")).toBeNull();
    expect(parseScannedCode("")).toBeNull();
  });
});

describe("isCompleteMegagameCode", () => {
  it("wants the full length", () => {
    expect(isCompleteMegagameCode("A2C4E")).toBe(false);
    expect(isCompleteMegagameCode("A2C4EF")).toBe(true);
  });
});

describe("normalizeAnswer", () => {
  it("keeps only letters and numbers, lowercased and unaccented", () => {
    expect(normalizeAnswer("  The Red Door ")).toBe("thereddoor");
    expect(normalizeAnswer("crème brûlée")).toBe("cremebrulee");
    expect(normalizeAnswer("it's a trap!")).toBe("itsatrap");
    expect(normalizeAnswer("")).toBe("");
  });
});

describe("matchAnswer", () => {
  it("ignores case and surrounding whitespace", () => {
    expect(matchAnswer("  The Red Door ", ["the red door"])).toEqual({
      matched: true,
      answer: "the red door",
    });
  });

  it("ignores accents in either direction", () => {
    expect(matchAnswer("creme brulee", ["crème brûlée"]).matched).toBe(true);
    expect(matchAnswer("crème brûlée", ["creme brulee"]).matched).toBe(true);
  });

  it("ignores punctuation", () => {
    expect(matchAnswer("it's a trap!", ["Its a trap"]).matched).toBe(true);
  });

  it("ignores internal whitespace", () => {
    expect(matchAnswer("red    door", ["red door"]).matched).toBe(true);
  });

  it("treats hyphenation and spacing as interchangeable", () => {
    expect(matchAnswer("co-op", ["co op"]).matched).toBe(true);
    expect(matchAnswer("co-op", ["coop"]).matched).toBe(true);
  });

  it("returns the accepted answer as stored", () => {
    expect(matchAnswer("second One", ["First", "Second one"])).toEqual({
      matched: true,
      answer: "Second one",
    });
  });

  it("reports no match", () => {
    expect(matchAnswer("blue door", ["the red door"])).toEqual({
      matched: false,
      answer: null,
    });
  });

  it("never matches an empty entry", () => {
    expect(matchAnswer("", ["", "red"])).toEqual({
      matched: false,
      answer: null,
    });
    expect(matchAnswer("!!!", ["", "red"]).matched).toBe(false);
  });

  it("never matches against an empty accepted list", () => {
    expect(matchAnswer("anything", [])).toEqual({
      matched: false,
      answer: null,
    });
  });
});

describe("checkLevelUp transitions", () => {
  const at = (wizard: number) => ({ ...NO_LEVELS, wizard });

  it("accepts the next level with nothing to say", () => {
    expect(
      checkLevelUp({
        class: "wizard",
        level: 1,
        levels: at(0),
        completionsInClass: 0,
      }),
    ).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it("refuses a level that is not a whole number of 1 or more", () => {
    for (const level of [0, 1.5, -1]) {
      const got = checkLevelUp({
        class: "wizard",
        level,
        levels: at(0),
        completionsInClass: 0,
      });
      expect(got.ok).toBe(false);
      expect(got.errors).toContain(
        "A level must be a whole number of 1 or more.",
      );
    }
  });

  it("refuses a level that is not above the current one", () => {
    for (const level of [3, 2]) {
      const got = checkLevelUp({
        class: "wizard",
        level,
        levels: at(3),
        completionsInClass: 9,
      });
      expect(got.ok).toBe(false);
      expect(got.errors).toEqual([
        "Already a level 3 wizard; a new level must be higher.",
      ]);
    }
  });

  it("refuses a level above the maximum", () => {
    const got = checkLevelUp({
      class: "wizard",
      level: MAX_LEVEL + 1,
      levels: at(MAX_LEVEL),
      completionsInClass: 0,
    });
    expect(got).toEqual({
      ok: false,
      errors: [`Level ${MAX_LEVEL + 1} is above the maximum of ${MAX_LEVEL}.`],
      warnings: [],
    });
  });

  it("accepts the maximum level itself", () => {
    const got = checkLevelUp({
      class: "wizard",
      level: MAX_LEVEL,
      levels: at(MAX_LEVEL - 1),
      completionsInClass: 0,
    });
    expect(got).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it("warns about one skipped level", () => {
    const got = checkLevelUp({
      class: "wizard",
      level: 3,
      levels: at(1),
      completionsInClass: 0,
    });
    expect(got.ok).toBe(true);
    expect(got.warnings).toEqual(["Skips level 2."]);
  });

  it("warns about several skipped levels", () => {
    const got = checkLevelUp({
      class: "wizard",
      level: 4,
      levels: at(0),
      completionsInClass: 0,
    });
    expect(got.warnings).toEqual(["Skips levels 1, 2 and 3."]);
  });

  it("refuses a level above the maximum without skip warnings", () => {
    for (const level of [MAX_LEVEL + 2, 400]) {
      const got = checkLevelUp({
        class: "wizard",
        level,
        levels: at(1),
        completionsInClass: 0,
      });
      expect(got).toEqual({
        ok: false,
        errors: [`Level ${level} is above the maximum of ${MAX_LEVEL}.`],
        warnings: [],
      });
    }
  });

  it("lists every skipped level up to the maximum", () => {
    const got = checkLevelUp({
      class: "wizard",
      level: MAX_LEVEL,
      levels: at(0),
      completionsInClass: 0,
    });
    expect(got.warnings).toEqual(["Skips levels 1, 2, 3 and 4."]);
  });

  it("refuses a huge level quickly", () => {
    const started = Date.now();
    const got = checkLevelUp({
      class: "wizard",
      level: 1_000_000_000,
      levels: at(0),
      completionsInClass: 0,
    });
    expect(got.ok).toBe(false);
    expect(got.warnings).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("names the class it was given", () => {
    const refused = checkLevelUp({
      class: "pirate",
      level: 1,
      levels: { ...NO_LEVELS, pirate: 2 },
      completionsInClass: 0,
    });
    expect(refused.errors).toEqual([
      "Already a level 2 pirate; a new level must be higher.",
    ]);
  });
});

describe("checkQuestWindow", () => {
  const levels = (wizard: number, pirate = 0) => ({
    ...NO_LEVELS,
    wizard,
    pirate,
  });

  it("says nothing about a classless quest", () => {
    expect(checkQuestWindow({ class: null }, levels(0))).toEqual({
      ok: true,
      warnings: [],
    });
    expect(
      checkQuestWindow({ class: null, minLevel: 2, maxLevel: 3 }, levels(0)),
    ).toEqual({ ok: true, warnings: [] });
  });

  it("treats an absent class the same as a null one", () => {
    expect(checkQuestWindow({}, levels(0))).toEqual({
      ok: true,
      warnings: [],
    });
    expect(checkQuestWindow({ class: undefined }, levels(0))).toEqual({
      ok: true,
      warnings: [],
    });
  });

  it("names the quest's own class in its warnings", () => {
    expect(checkQuestWindow({ class: "pirate" }, levels(2)).warnings).toEqual([
      "Not a pirate yet.",
    ]);
    expect(
      checkQuestWindow({ class: "pirate", minLevel: 3 }, levels(0, 1)).warnings,
    ).toEqual(["Level 1 pirate; this quest asks for level 3 or higher."]);
  });

  it("accepts a player inside the window", () => {
    expect(
      checkQuestWindow(
        { class: "wizard", minLevel: 1, maxLevel: 3 },
        levels(2),
      ),
    ).toEqual({ ok: true, warnings: [] });
  });

  it("warns below the minimum level", () => {
    expect(
      checkQuestWindow({ class: "wizard", minLevel: 2 }, levels(1)),
    ).toEqual({
      ok: false,
      warnings: ["Level 1 wizard; this quest asks for level 2 or higher."],
    });
  });

  it("warns above the maximum level", () => {
    expect(
      checkQuestWindow({ class: "wizard", maxLevel: 3 }, levels(4)),
    ).toEqual({
      ok: false,
      warnings: ["Level 4 wizard; this quest is for level 3 and below."],
    });
  });

  it("warns when the player is not in the quest's class", () => {
    expect(checkQuestWindow({ class: "wizard" }, levels(0))).toEqual({
      ok: false,
      warnings: ["Not a wizard yet."],
    });
    expect(
      checkQuestWindow({ class: "wizard", minLevel: 2 }, levels(0)).warnings,
    ).toEqual(["Not a wizard yet."]);
  });

  it("accepts a classed quest with no window", () => {
    expect(checkQuestWindow({ class: "wizard" }, levels(2))).toEqual({
      ok: true,
      warnings: [],
    });
  });

  it("looks only at the quest's own class", () => {
    expect(
      checkQuestWindow({ class: "wizard" }, levels(0, 3)).warnings,
    ).toEqual(["Not a wizard yet."]);
  });

  it("warns about an unknown class without throwing", () => {
    expect(checkQuestWindow({ class: "sorcerer" }, levels(2))).toEqual({
      ok: false,
      warnings: ['Quest class "sorcerer" is not a known class.'],
    });
  });
});

describe("questWindowIsValid", () => {
  it("lets a classless quest through only without a window", () => {
    expect(questWindowIsValid({ class: null })).toBe(true);
    expect(
      questWindowIsValid({ class: null, minLevel: null, maxLevel: null }),
    ).toBe(true);
    expect(questWindowIsValid({ class: null, minLevel: 2 })).toBe(false);
    expect(questWindowIsValid({ class: null, maxLevel: 2 })).toBe(false);
  });

  it("treats an absent class the same as a null one", () => {
    expect(questWindowIsValid({})).toBe(true);
    expect(questWindowIsValid({ minLevel: 2 })).toBe(false);
  });

  it("lets a classed quest carry either bound", () => {
    expect(questWindowIsValid({ class: "wizard", minLevel: 2 })).toBe(true);
    expect(questWindowIsValid({ class: "wizard", maxLevel: 2 })).toBe(true);
    expect(questWindowIsValid({ class: "wizard" })).toBe(true);
  });
});

describe("bucket sizes", () => {
  it("whitelists the interval literals and throws on anything else", () => {
    expect(bucketIntervalSql("5m")).toBe("5 minutes");
    expect(bucketIntervalSql("1h")).toBe("1 hour");
    expect(bucketIntervalSql("1d")).toBe("1 day");
    expect(() => bucketIntervalSql("2h")).toThrow();
    expect(() => bucketIntervalSql("1h; drop table quests")).toThrow();
    expect(() => bucketIntervalSql("")).toThrow();
  });

  it("recognises only its own sizes", () => {
    for (const size of BUCKET_SIZES) expect(isBucketSize(size)).toBe(true);
    expect(isBucketSize("2h")).toBe(false);
    expect(isBucketSize("")).toBe(false);
    expect(isBucketSize(null)).toBe(false);
  });

  it("gives minutes for every size", () => {
    expect(BUCKET_MINUTES).toEqual({
      "5m": 5,
      "15m": 15,
      "30m": 30,
      "1h": 60,
      "3h": 180,
      "6h": 360,
      "1d": 1440,
    });
  });
});

describe("bucketStart", () => {
  const iso = (at: Date) => at.toISOString();

  it("floors to the quarter hour", () => {
    expect(iso(bucketStart(new Date("2026-11-07T10:07:00.000Z"), "15m"))).toBe(
      "2026-11-07T10:00:00.000Z",
    );
    expect(iso(bucketStart(new Date("2026-11-07T10:15:00.000Z"), "15m"))).toBe(
      "2026-11-07T10:15:00.000Z",
    );
    expect(iso(bucketStart(new Date("2026-11-07T10:14:59.999Z"), "15m"))).toBe(
      "2026-11-07T10:00:00.000Z",
    );
  });

  it("floors at every size", () => {
    const at = new Date("2026-11-07T10:07:00.000Z");
    const expected: Record<string, string> = {
      "5m": "2026-11-07T10:05:00.000Z",
      "30m": "2026-11-07T10:00:00.000Z",
      "3h": "2026-11-07T08:00:00.000Z",
      "6h": "2026-11-07T08:00:00.000Z",
      "1d": "2026-11-07T08:00:00.000Z",
    };
    for (const [size, want] of Object.entries(expected)) {
      expect(iso(bucketStart(at, size as BucketSize)), size).toBe(want);
    }
  });

  it("is idempotent", () => {
    const at = new Date("2026-11-07T10:07:33.123Z");
    for (const size of BUCKET_SIZES) {
      expect(iso(bucketStart(bucketStart(at, size), size))).toBe(
        iso(bucketStart(at, size)),
      );
    }
  });

  it("floors downwards before the origin too", () => {
    expect(iso(bucketStart(new Date("2026-01-01T07:58:00.000Z"), "15m"))).toBe(
      "2026-01-01T07:45:00.000Z",
    );
  });

  it("starts days at midnight Pacific standard time", () => {
    expect(BUCKET_ORIGIN.toISOString()).toBe("2026-01-01T08:00:00.000Z");
    expect(iso(bucketStart(new Date("2026-11-08T07:59:00.000Z"), "1d"))).toBe(
      "2026-11-07T08:00:00.000Z",
    );
    expect(iso(bucketStart(new Date("2026-11-08T08:00:00.000Z"), "1d"))).toBe(
      "2026-11-08T08:00:00.000Z",
    );
  });
});

describe("bucketSeries", () => {
  const isos = (at: Date[]) => at.map((d) => d.toISOString());

  it("includes the buckets holding both endpoints", () => {
    expect(
      isos(
        bucketSeries(
          new Date("2026-11-07T10:07:00.000Z"),
          new Date("2026-11-07T12:07:00.000Z"),
          "30m",
        ),
      ),
    ).toEqual([
      "2026-11-07T10:00:00.000Z",
      "2026-11-07T10:30:00.000Z",
      "2026-11-07T11:00:00.000Z",
      "2026-11-07T11:30:00.000Z",
      "2026-11-07T12:00:00.000Z",
    ]);
    expect(
      isos(
        bucketSeries(
          new Date("2026-11-07T10:07:00.000Z"),
          new Date("2026-11-07T12:07:00.000Z"),
          "1h",
        ),
      ),
    ).toEqual([
      "2026-11-07T10:00:00.000Z",
      "2026-11-07T11:00:00.000Z",
      "2026-11-07T12:00:00.000Z",
    ]);
  });

  it("handles endpoints already on a boundary", () => {
    expect(
      isos(
        bucketSeries(
          new Date("2026-11-07T10:00:00.000Z"),
          new Date("2026-11-07T11:00:00.000Z"),
          "30m",
        ),
      ),
    ).toEqual([
      "2026-11-07T10:00:00.000Z",
      "2026-11-07T10:30:00.000Z",
      "2026-11-07T11:00:00.000Z",
    ]);
  });

  it("gives one entry for an instant and none for a reversed range", () => {
    const at = new Date("2026-11-07T10:07:00.000Z");
    expect(isos(bucketSeries(at, at, "5m"))).toEqual([
      "2026-11-07T10:05:00.000Z",
    ]);
    expect(
      bucketSeries(at, new Date("2026-11-07T09:00:00.000Z"), "5m"),
    ).toEqual([]);
  });
});

describe("playerQuestStatus", () => {
  const wizardQuest = { class: "wizard", minLevel: 2, maxLevel: null };
  const levels = { wizard: 2, pirate: 0, alien: 0 };

  it("is ok with no warnings for an in-window player with a ticket", () => {
    expect(
      playerQuestStatus({
        quest: wizardQuest,
        levels,
        completed: false,
        hasTicket: true,
      }),
    ).toEqual({ kind: "ok", warnings: [] });
  });

  it("blocks a player who already completed the quest, whatever else holds", () => {
    expect(
      playerQuestStatus({
        quest: wizardQuest,
        levels: NO_LEVELS,
        completed: true,
        hasTicket: false,
      }),
    ).toEqual({ kind: "completed" });
  });

  it("warns, without blocking, outside the window and without a ticket", () => {
    expect(
      playerQuestStatus({
        quest: wizardQuest,
        levels: { wizard: 1, pirate: 0, alien: 0 },
        completed: false,
        hasTicket: false,
      }),
    ).toEqual({
      kind: "ok",
      warnings: [
        "Level 1 wizard; this quest asks for level 2 or higher.",
        "No claimed ticket.",
      ],
    });
  });
});
