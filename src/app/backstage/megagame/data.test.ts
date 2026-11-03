import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, tickets } = vi.hoisted(() => ({
  store: {
    playersByIds: vi.fn(),
    liveCompletions: vi.fn(),
    findQuestByCode: vi.fn(),
    recentConfirmations: vi.fn(),
    recentLevelUps: vi.fn(),
    recentVoids: vi.fn(),
  },
  tickets: { claimedCounts: vi.fn() },
}));
vi.mock("@/lib/megagame-store", () => store);
vi.mock("@/lib/ticket-store", () => tickets);

import {
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
  code: null,
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
        confirmationId: "c1",
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
const confirmation = (id: string, m: number, by: string, voided = false) => ({
  id,
  questId: "q1",
  questTitle: "Riddle",
  questCode: "A2C4EF",
  players: 2,
  confirmedBy: by,
  confirmedByName: by.toUpperCase(),
  createdAt: t(m),
  voidedAt: voided ? t(m + 1) : null,
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
  kind: "confirmation" as const,
  id,
  voidedAt: t(m),
  voidedByName: "Boss",
  reason: "typo",
  questTitle: "Riddle",
  playerName: null,
  class: null,
  level: null,
});

describe("mergeRecentActions", () => {
  const sources = {
    confirmations: [confirmation("c1", 5, "v1"), confirmation("c2", 1, "v2")],
    levelUps: [levelUp("l1", 4, "v2"), levelUp("l2", 2, "v1", true)],
    voids: [voidRow("c0", 3)],
  };

  it("puts every kind in one list, newest first, cut to the limit", () => {
    const rows = mergeRecentActions(
      sources,
      { userId: "v1", manager: false },
      4,
    );
    expect(rows.map((r) => [r.kind, r.at.getUTCMinutes()])).toEqual([
      ["confirmation", 5],
      ["level", 4],
      ["void", 3],
      ["level", 2],
    ]);
  });

  it("offers undo on the viewer's own live items only", () => {
    const rows = mergeRecentActions(
      sources,
      { userId: "v1", manager: false },
      10,
    );
    expect(rows.map((r) => [r.key, r.mayUndo])).toEqual([
      ["confirmation-c1", true],
      ["level-l1", false],
      ["void-confirmation-c0", false],
      ["level-l2", false],
      ["confirmation-c2", false],
    ]);
  });

  it("offers undo on anyone's live items to a manager", () => {
    const rows = mergeRecentActions(
      sources,
      { userId: "m1", manager: true },
      10,
    );
    expect(rows.filter((r) => r.mayUndo).map((r) => r.key)).toEqual([
      "confirmation-c1",
      "level-l1",
      "confirmation-c2",
    ]);
  });
});

describe("loadRecentActions", () => {
  it("asks each source for the limit and reports when there may be more", async () => {
    store.recentConfirmations.mockResolvedValue([confirmation("c1", 5, "v1")]);
    store.recentLevelUps.mockResolvedValue([levelUp("l1", 4, "v1")]);
    store.recentVoids.mockResolvedValue([]);
    const viewer = { userId: "v1", manager: false };
    const few = await loadRecentActions(30, viewer);
    expect(store.recentConfirmations).toHaveBeenCalledWith(null, 30);
    expect(store.recentLevelUps).toHaveBeenCalledWith(30);
    expect(store.recentVoids).toHaveBeenCalledWith(30);
    expect(few.actions).toHaveLength(2);
    expect(few.more).toBe(false);

    const many = await loadRecentActions(1, viewer);
    expect(many.actions.map((a) => a.key)).toEqual(["confirmation-c1"]);
    expect(many.more).toBe(true);
  });
});
