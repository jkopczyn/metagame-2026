import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, tickets } = vi.hoisted(() => ({
  store: {
    playersByIds: vi.fn(),
    liveCompletions: vi.fn(),
    findQuestByCode: vi.fn(),
    completionsByIds: vi.fn(),
  },
  tickets: { claimedCounts: vi.fn() },
}));
vi.mock("@/lib/megagame-store", () => store);
vi.mock("@/lib/ticket-store", () => tickets);

import { loadCompletionResult, loadPlayerRows, loadQuest } from "./data";

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
