import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, tickets } = vi.hoisted(() => ({
  store: {
    playersByIds: vi.fn(),
    liveCompletions: vi.fn(),
    findQuestByCode: vi.fn(),
    completionsByIds: vi.fn(),
    recentCompletions: vi.fn(),
    recentLevelUps: vi.fn(),
    recentVoids: vi.fn(),
    completionSeries: vi.fn(),
    levelEventSeries: vi.fn(),
    completionsInClass: vi.fn(),
  },
  tickets: { claimedCounts: vi.fn() },
}));
vi.mock("@/lib/megagame-store", () => store);
vi.mock("@/lib/ticket-store", () => tickets);

import { parseBoardParams } from "./board-params";
import { overTimeView } from "./over-time/view";
import {
  loadCompletionResult,
  loadLevelUpTarget,
  loadOverTime,
  loadPlayerRows,
  loadQuest,
  loadRecentActions,
  mergeRecentActions,
} from "./data";

const player = (id: string, wizard = 1) => ({
  id,
  name: id.toUpperCase(),
  pronouns: null,
  imageUrl: null,
  levels: { wizard, pirate: 0, alien: 0 },
});

beforeEach(() => {
  vi.clearAllMocks();
  store.playersByIds.mockResolvedValue([player("u1"), player("u2", 0)]);
  store.liveCompletions.mockResolvedValue([]);
  tickets.claimedCounts.mockResolvedValue(new Map([["u1", 1]]));
});

describe("loadPlayerRows", () => {
  it("without a quest, warns only about a missing ticket", async () => {
    const rows = await loadPlayerRows(["u1", "u2"], null);
    expect(rows.map((r) => [r.player.id, r.status])).toEqual([
      ["u1", { kind: "ok", warnings: [] }],
      ["u2", { kind: "ok", warnings: ["No claimed ticket."] }],
    ]);
    expect(store.liveCompletions).not.toHaveBeenCalled();
  });

  it("with a quest, blocks a live completion and says when and by whom", async () => {
    const at = new Date("2026-11-07T18:00:00Z");
    store.liveCompletions.mockResolvedValue([
      {
        id: "k1",
        userId: "u1",
        confirmedAt: at,
        confirmedByName: "Vol",
      },
    ]);
    const quest = { id: "q1", class: "wizard", minLevel: null, maxLevel: null };
    const rows = await loadPlayerRows(["u1", "u2"], quest);
    expect(store.liveCompletions).toHaveBeenCalledWith("q1", ["u1", "u2"]);
    expect(rows[0].status).toEqual({ kind: "completed" });
    expect(rows[0].completion).toEqual({ at, by: "Vol" });
    expect(rows[1].status).toEqual({
      kind: "ok",
      warnings: ["Not a wizard yet.", "No claimed ticket."],
    });
  });

  it("skips every query for an empty list", async () => {
    expect(await loadPlayerRows([], null)).toEqual([]);
    expect(store.playersByIds).not.toHaveBeenCalled();
  });
});

describe("loadQuest", () => {
  it("does not query for an incomplete code", async () => {
    expect(await loadQuest("A2C")).toEqual({ status: "unknown" });
    expect(store.findQuestByCode).not.toHaveBeenCalled();
  });

  it("tells an unknown code from an inactive quest", async () => {
    store.findQuestByCode.mockResolvedValue(null);
    expect(await loadQuest("A2C4EF")).toEqual({ status: "unknown" });
    const quest = { id: "q1", code: "A2C4EF", active: false };
    store.findQuestByCode.mockResolvedValue(quest);
    expect(await loadQuest("A2C4EF")).toEqual({ status: "inactive", quest });
    store.findQuestByCode.mockResolvedValue({ ...quest, active: true });
    expect((await loadQuest("A2C4EF")).status).toBe("open");
  });
});

const t = (m: number) => new Date(Date.UTC(2026, 10, 7, 18, m));
const completion = (id: string, m: number, by: string, undone = false) => ({
  id,
  questId: "q1",
  questTitle: "Riddle",
  questCode: "A2C4EF",
  userId: "u1",
  playerName: "Ada",
  confirmedBy: by,
  confirmedByName: by.toUpperCase(),
  completedAt: t(m),
  undoneAt: undone ? t(m + 1) : null,
  undoneByName: undone ? "Boss" : null,
  undoReason: undone ? "typo" : null,
});
const levelUp = (id: string, m: number, by: string, voided = false) => ({
  id,
  playerName: "Ada",
  class: "wizard",
  level: 2,
  awardedBy: by,
  awardedByName: by.toUpperCase(),
  awardedAt: t(m),
  checksPassed: true,
  overrideReason: null,
  cardPhotoUrl: null,
  note: null,
  voidedAt: voided ? t(m + 1) : null,
});
const voidRow = (id: string, m: number) => ({
  id,
  voidedAt: t(m),
  voidedByName: "Boss",
  reason: "typo",
  playerName: "Ada",
  class: "wizard",
  level: 2,
});

describe("mergeRecentActions", () => {
  const sources = {
    completions: [
      completion("p1", 5, "v1"),
      completion("p2", 1, "v2"),
      completion("p3", 0, "v1", true),
    ],
    levelUps: [levelUp("l1", 4, "v2"), levelUp("l2", 2, "v1", true)],
    voids: [voidRow("l0", 3)],
  };

  it("puts every kind in one list, newest first, cut to the limit", () => {
    const rows = mergeRecentActions(
      sources,
      { userId: "v1", manager: false },
      4,
    );
    expect(rows.map((r) => [r.kind, r.at.getUTCMinutes()])).toEqual([
      ["completion", 5],
      ["level", 4],
      ["void", 3],
      ["level", 2],
    ]);
  });

  it("offers undo on the viewer's own live items only, never on an undone row", () => {
    const rows = mergeRecentActions(
      sources,
      { userId: "v1", manager: false },
      10,
    );
    expect(rows.map((r) => [r.key, r.mayUndo])).toEqual([
      ["completion-p1", true],
      ["level-l1", false],
      ["void-l0", false],
      ["level-l2", false],
      ["completion-p2", false],
      ["completion-p3", false],
    ]);
  });

  it("offers undo on anyone's live items to a manager", () => {
    const rows = mergeRecentActions(
      sources,
      { userId: "m1", manager: true },
      10,
    );
    expect(rows.filter((r) => r.mayUndo).map((r) => r.key)).toEqual([
      "completion-p1",
      "level-l1",
      "completion-p2",
    ]);
  });
});

describe("loadRecentActions", () => {
  it("asks each source for one past the limit and reports when there is more", async () => {
    store.recentCompletions.mockResolvedValue([completion("p1", 5, "v1")]);
    store.recentLevelUps.mockResolvedValue([levelUp("l1", 4, "v1")]);
    store.recentVoids.mockResolvedValue([]);
    const viewer = { userId: "v1", manager: false };
    const few = await loadRecentActions(30, viewer);
    expect(store.recentCompletions).toHaveBeenCalledWith(null, 31);
    expect(store.recentLevelUps).toHaveBeenCalledWith(31);
    expect(store.recentVoids).toHaveBeenCalledWith(31);
    expect(few.actions).toHaveLength(2);
    expect(few.more).toBe(false);

    const many = await loadRecentActions(1, viewer);
    expect(many.actions.map((a) => a.key)).toEqual(["completion-p1"]);
    expect(many.more).toBe(true);
  });

  it("does not offer more when the actions fill the limit exactly", async () => {
    store.recentCompletions.mockResolvedValue([
      completion("p1", 5, "v1"),
      completion("p2", 4, "v1"),
    ]);
    store.recentLevelUps.mockResolvedValue([]);
    store.recentVoids.mockResolvedValue([]);
    const exact = await loadRecentActions(2, { userId: "v1", manager: false });
    expect(exact.actions).toHaveLength(2);
    expect(exact.more).toBe(false);
  });
});

describe("loadOverTime", () => {
  it("queries the series over the chosen range, with day buckets from Pacific midnight", async () => {
    store.completionSeries.mockResolvedValue([]);
    store.levelEventSeries.mockResolvedValue([]);
    const view = overTimeView(
      parseBoardParams({ range: "con", bucket: "1d" }),
      new Date("2026-11-01T18:00:00.000Z"),
    );
    const rows = await loadOverTime(view);
    const from = new Date("2026-11-06T08:00:00.000Z");
    const to = new Date("2026-11-09T08:00:00.000Z");
    expect(store.completionSeries).toHaveBeenCalledWith("1d", from, to);
    expect(store.levelEventSeries).toHaveBeenCalledWith("1d", from, to);
    expect(rows).toHaveLength(3);
  });

  it("skips the queries when the range has too many buckets", async () => {
    const view = overTimeView(
      parseBoardParams({ range: "con", bucket: "5m" }),
      new Date("2026-11-07T18:00:00.000Z"),
    );
    expect(await loadOverTime(view)).toEqual([]);
    expect(store.completionSeries).not.toHaveBeenCalled();
  });
});

describe("loadCompletionResult", () => {
  const quest = { id: "q1" } as never;
  const row = (
    id: string,
    userId: string,
    extra: Partial<{
      questId: string;
      status: string;
      confirmedBy: string;
    }> = {},
  ) => ({
    id,
    userId,
    questId: "q1",
    status: "completed",
    confirmedBy: "v1",
    completedAt: new Date(),
    undoneAt: null,
    ...extra,
  });
  const me = { userId: "v1", manager: false };

  it("names the recorded rows and the listed players who were already completed", async () => {
    store.completionsByIds.mockResolvedValue([row("p1", "u1")]);
    store.liveCompletions.mockResolvedValue([
      { id: "p2", userId: "u2", confirmedAt: new Date(), confirmedByName: "W" },
    ]);
    const view = await loadCompletionResult(["p1"], quest, ["u1", "u2"], me);
    expect(view).toEqual({
      recorded: [{ id: "p1", name: "U1", undone: false }],
      alreadyCompleted: ["U2"],
      undoIds: ["p1"],
    });
    expect(store.liveCompletions).toHaveBeenCalledWith("q1", ["u2"]);
    expect(store.playersByIds).toHaveBeenCalledWith(["u1", "u2"]);
  });

  it("drops rows of another quest and marks undone rows, leaving them out of Undo all", async () => {
    store.completionsByIds.mockResolvedValue([
      row("p1", "u1", { status: "attempted" }),
      row("p9", "u2", { questId: "q2" }),
    ]);
    const view = await loadCompletionResult(["p1", "p9"], quest, [], me);
    expect(view.recorded).toEqual([{ id: "p1", name: "U1", undone: true }]);
    expect(view.undoIds).toEqual([]);
  });

  it("offers Undo all only to the volunteer who recorded every row, or a manager", async () => {
    store.completionsByIds.mockResolvedValue([
      row("p1", "u1"),
      row("p2", "u2", { confirmedBy: "v2" }),
    ]);
    expect(
      (await loadCompletionResult(["p1", "p2"], quest, [], me)).undoIds,
    ).toEqual([]);
    expect(
      (
        await loadCompletionResult(["p1", "p2"], quest, [], {
          userId: "m1",
          manager: true,
        })
      ).undoIds,
    ).toEqual(["p1", "p2"]);
  });

  it("reads no rows for an empty result", async () => {
    store.playersByIds.mockResolvedValue([]);
    const view = await loadCompletionResult([], quest, [], me);
    expect(view).toEqual({ recorded: [], alreadyCompleted: [], undoIds: [] });
    expect(store.completionsByIds).not.toHaveBeenCalled();
  });
});

describe("loadLevelUpTarget", () => {
  it("is null for an unknown player and counts completions per class otherwise", async () => {
    store.playersByIds.mockResolvedValueOnce([]);
    expect(await loadLevelUpTarget("nope")).toBeNull();
    store.completionsInClass.mockImplementation(async (_u, c: string) =>
      c === "wizard" ? 3 : 0,
    );
    const target = await loadLevelUpTarget("u1");
    expect(target?.completions).toEqual({ wizard: 3, pirate: 0, alien: 0 });
  });
});
