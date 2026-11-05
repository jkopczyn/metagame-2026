import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, store, nav } = vi.hoisted(() => ({
  auth: {
    EXPIRED: "Your session expired. Reload.",
    requireAccess: vi.fn(),
  },
  store: {
    findPlayerByBadgeNumber: vi.fn(),
    findQuestByCode: vi.fn(),
    searchPlayers: vi.fn(),
    confirmCompletions: vi.fn(),
    completionsByIds: vi.fn(),
    undoCompletions: vi.fn(),
  },
  nav: {
    redirect: vi.fn((to: string) => {
      throw new Error(`REDIRECT ${to}`);
    }),
  },
}));
vi.mock("@/lib/admin-auth", () => auth);
vi.mock("@/lib/megagame-store", () => store);
vi.mock("next/navigation", () => nav);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  confirmCompletions,
  findPlayers,
  lookupPlayer,
  undoCompletions,
} from "./actions";

const ME = { name: "Vol", userId: "v1" };
const ID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const ID2 = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const QUEST = "0b9c8d7e-6f5a-4b3c-9d2e-1f0a9b8c7d6e";

/** Grants exactly these permissions to the signed-in volunteer. */
const holds = (...perms: string[]) =>
  auth.requireAccess.mockImplementation(async (p: string) =>
    perms.includes(p) ? ME : null,
  );

const form = (fields: Record<string, string | string[] | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields))
    for (const item of [v].flat()) f.append(k, item);
  return f;
};

const ada = {
  id: "u1",
  name: "Ada",
  pronouns: null,
  imageUrl: null,
  levels: { wizard: 1, pirate: 0, alien: 0 },
  badgeNumber: 42,
};
/** What a lookup sends to the browser: no badge number and no levels. */
const adaHit = { id: "u1", name: "Ada", pronouns: null, imageUrl: null };

beforeEach(() => {
  vi.clearAllMocks();
  holds("megagame.verify");
});

describe("gating", () => {
  it("refuses every action without megagame.verify and touches no data", async () => {
    holds();
    expect(await lookupPlayer("0042")).toEqual({ error: auth.EXPIRED });
    expect(await findPlayers("Ada")).toEqual({ error: auth.EXPIRED });
    expect(
      await confirmCompletions(
        {},
        form({ questId: QUEST, questCode: "A2C4EF", player: "u1" }),
      ),
    ).toEqual({ error: auth.EXPIRED });
    expect(await undoCompletions({}, form({ id: ID }))).toEqual({
      error: auth.EXPIRED,
    });
    for (const fn of Object.values(store)) expect(fn).not.toHaveBeenCalled();
  });

  it("checks megagame.verify for the lookups", async () => {
    store.findPlayerByBadgeNumber.mockResolvedValue(ada);
    store.searchPlayers.mockResolvedValue([ada]);
    expect(await lookupPlayer("0042")).toEqual({ player: adaHit });
    expect(store.findPlayerByBadgeNumber).toHaveBeenCalledWith(42);
    expect(await findPlayers("Ad")).toEqual({ players: [adaHit] });
    expect(auth.requireAccess).toHaveBeenCalledWith("megagame.verify");
  });

  it("says so when no player has the badge number", async () => {
    store.findPlayerByBadgeNumber.mockResolvedValue(null);
    expect(await lookupPlayer("42")).toEqual({
      error: "No player has badge number 0042.",
    });
  });

  it("asks for a badge number when the input is not one", async () => {
    expect(await lookupPlayer("B3D5F7")).toEqual({
      error: "Enter the four-digit badge number.",
    });
    expect(store.findPlayerByBadgeNumber).not.toHaveBeenCalled();
  });
});

describe("confirmCompletions", () => {
  const submit = (players: string[], list?: string, board?: string) =>
    confirmCompletions(
      {},
      form({
        questId: QUEST,
        questCode: "a2c4ef",
        player: players,
        ...(list === undefined ? {} : { list }),
        ...(board === undefined ? {} : { board }),
      }),
    );
  const ok = (recorded: string[]) => ({
    status: "ok",
    recorded: recorded.map((id, i) => ({ id, userId: `u${i + 1}` })),
    alreadyCompleted: [],
    notRecorded: [],
  });

  beforeEach(() => {
    store.findQuestByCode.mockResolvedValue({
      id: QUEST,
      code: "A2C4EF",
      active: true,
    });
  });

  it("refuses a quest code that does not name the posted quest, before writing", async () => {
    store.findQuestByCode.mockResolvedValue({
      id: ID,
      code: "A2C4EF",
      active: true,
    });
    expect(await submit(["u1"])).toEqual({
      error: "This form is out of date. Reload and try again.",
    });
    store.findQuestByCode.mockResolvedValue(null);
    expect((await submit(["u1"])).error).toMatch(/out of date/);
    expect(store.confirmCompletions).not.toHaveBeenCalled();
  });

  it("refuses a malformed quest id before writing", async () => {
    expect(
      await confirmCompletions(
        {},
        form({ questId: "nope", questCode: "a2c4ef", player: "u1" }),
      ),
    ).toEqual({ error: "This form is out of date. Reload and try again." });
    expect(store.confirmCompletions).not.toHaveBeenCalled();
  });

  it("refuses an inactive quest, before writing", async () => {
    store.findQuestByCode.mockResolvedValue({
      id: QUEST,
      code: "A2C4EF",
      active: false,
    });
    expect((await submit(["u1"])).error).toMatch(/not active/);
    expect(store.confirmCompletions).not.toHaveBeenCalled();
  });

  it("keeps the whole player list on the board with the result", async () => {
    store.confirmCompletions.mockResolvedValue(ok([ID]));
    await expect(submit(["u1"], "u1,u3")).rejects.toThrow(
      `REDIRECT /backstage/megagame?quest=A2C4EF&players=u1%2Cu3&done=${ID}`,
    );
  });

  it("records as the signed-in volunteer and puts the recorded row ids in the URL", async () => {
    store.confirmCompletions.mockResolvedValue(ok([ID, ID2]));
    await expect(submit(["u1", "u2"])).rejects.toThrow(
      `REDIRECT /backstage/megagame?quest=A2C4EF&done=${ID}%2C${ID2}`,
    );
    expect(store.confirmCompletions).toHaveBeenCalledWith({
      questId: QUEST,
      userIds: ["u1", "u2"],
      confirmedBy: "v1",
    });
  });

  it("still opens the result when nobody new was recorded", async () => {
    store.confirmCompletions.mockResolvedValue(ok([]));
    await expect(submit(["u1"])).rejects.toThrow(
      "REDIRECT /backstage/megagame?quest=A2C4EF&done=",
    );
  });

  it("asks for a player when the list is empty", async () => {
    store.confirmCompletions.mockResolvedValueOnce({ status: "no-players" });
    expect(await submit([])).toEqual({ error: "Add at least one player." });
  });
});

describe("undoCompletions", () => {
  const row = (id: string, confirmedBy: string) => ({
    id,
    userId: "u1",
    questId: QUEST,
    status: "completed",
    confirmedBy,
  });

  it("lets the recording volunteer undo every listed row, with the reason", async () => {
    store.completionsByIds.mockResolvedValue([row(ID, "v1"), row(ID2, "v1")]);
    store.undoCompletions.mockResolvedValue([ID, ID2]);
    expect(
      await undoCompletions(
        {},
        form({ id: [ID, ID2, "nope"], reason: " wrong quest " }),
      ),
    ).toEqual({ done: true });
    expect(store.completionsByIds).toHaveBeenCalledWith([ID, ID2]);
    expect(store.undoCompletions).toHaveBeenCalledWith({
      ids: [ID, ID2],
      by: "v1",
      reason: "wrong quest",
    });
  });

  it("refuses when any row is another volunteer's, without megagame.manage", async () => {
    store.completionsByIds.mockResolvedValue([row(ID, "v1"), row(ID2, "v2")]);
    expect((await undoCompletions({}, form({ id: [ID, ID2] }))).error).toMatch(
      /only the volunteer who recorded it/i,
    );
    expect(store.undoCompletions).not.toHaveBeenCalled();
  });

  it("lets megagame.manage undo anyone's rows", async () => {
    holds("megagame.verify", "megagame.manage");
    store.completionsByIds.mockResolvedValue([row(ID, "v2")]);
    store.undoCompletions.mockResolvedValue([ID]);
    expect(await undoCompletions({}, form({ id: ID }))).toEqual({
      done: true,
    });
    expect(store.undoCompletions).toHaveBeenCalledWith({
      ids: [ID],
      by: "v1",
      reason: null,
    });
  });

  it("reports rows that are not found, without querying for malformed ids", async () => {
    store.completionsByIds.mockResolvedValue([]);
    expect((await undoCompletions({}, form({ id: ID }))).error).toMatch(
      /not found/i,
    );
    expect((await undoCompletions({}, form({ id: "nope" }))).error).toMatch(
      /not found/i,
    );
    expect(store.completionsByIds).toHaveBeenCalledTimes(1);
    expect(store.undoCompletions).not.toHaveBeenCalled();
  });
});
