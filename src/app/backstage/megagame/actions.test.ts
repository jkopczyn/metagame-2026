import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, store, blob, nav } = vi.hoisted(() => ({
  auth: {
    EXPIRED: "Your session expired. Reload.",
    requireAccess: vi.fn(),
  },
  store: {
    findPlayerByCode: vi.fn(),
    findQuestByCode: vi.fn(),
    searchPlayers: vi.fn(),
    playersByIds: vi.fn(),
    confirmQuest: vi.fn(),
    confirmationOutcome: vi.fn(),
    voidConfirmation: vi.fn(),
    voidCompletion: vi.fn(),
    completionsInClass: vi.fn(),
    findLevelEvent: vi.fn(),
    recordLevelUp: vi.fn(),
    voidLevelEvent: vi.fn(),
    recordQuestAttempt: vi.fn(),
  },
  blob: {
    LARGE_IMAGE_MAX_BYTES: 900 * 1024,
    uploadImage: vi.fn(),
  },
  nav: {
    redirect: vi.fn((to: string) => {
      throw new Error(`REDIRECT ${to}`);
    }),
  },
}));
vi.mock("@/lib/admin-auth", () => auth);
vi.mock("@/lib/megagame-store", () => store);
vi.mock("@/lib/blob", () => blob);
vi.mock("next/navigation", () => nav);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  confirmCompletions,
  findPlayers,
  levelUp,
  logAnswerAttempt,
  lookupPlayer,
  undoCompletion,
  undoConfirmation,
  undoLevelUp,
} from "./actions";

const ME = { name: "Vol", userId: "v1" };
const ID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
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
  code: "B3D5F7",
};
/** What a lookup sends to the browser: no badge code and no levels. */
const adaHit = { id: "u1", name: "Ada", pronouns: null, imageUrl: null };

beforeEach(() => {
  vi.clearAllMocks();
  holds("megagame.verify");
});

describe("gating", () => {
  it("refuses every action without megagame.verify and touches no data", async () => {
    holds();
    expect(await lookupPlayer("B3D5F7")).toEqual({ error: auth.EXPIRED });
    expect(await findPlayers("Ada")).toEqual({ error: auth.EXPIRED });
    expect(
      await confirmCompletions(
        {},
        form({ id: ID, questId: QUEST, questCode: "A2C4EF", player: "u1" }),
      ),
    ).toEqual({ error: auth.EXPIRED });
    expect(await undoConfirmation({}, form({ id: ID }))).toEqual({
      error: auth.EXPIRED,
    });
    expect(
      await levelUp(
        {},
        form({ id: ID, userId: "u1", class: "wizard", level: "2" }),
      ),
    ).toEqual({ error: auth.EXPIRED });
    expect(await undoLevelUp({}, form({ id: ID }))).toEqual({
      error: auth.EXPIRED,
    });
    for (const fn of Object.values(store)) expect(fn).not.toHaveBeenCalled();
  });

  it("checks megagame.verify for the lookups", async () => {
    store.findPlayerByCode.mockResolvedValue(ada);
    store.searchPlayers.mockResolvedValue([ada]);
    expect(await lookupPlayer("b3d-5f7")).toEqual({ player: adaHit });
    expect(await findPlayers("Ad")).toEqual({ players: [adaHit] });
    expect(auth.requireAccess).toHaveBeenCalledWith("megagame.verify");
  });

  it("says so when no player has the code", async () => {
    store.findPlayerByCode.mockResolvedValue(null);
    expect(await lookupPlayer("B3D5F7")).toEqual({
      error: "No player has code B3D-5F7.",
    });
  });
});

describe("confirmCompletions", () => {
  const submit = (players: string[], id = ID, list?: string, board?: string) =>
    confirmCompletions(
      {},
      form({
        id,
        questId: QUEST,
        questCode: "a2c4ef",
        player: players,
        ...(list === undefined ? {} : { list }),
        ...(board === undefined ? {} : { board }),
      }),
    );

  beforeEach(() => {
    store.findQuestByCode.mockResolvedValue({ id: QUEST, code: "A2C4EF" });
  });

  it("refuses a quest code that does not name the posted quest, before writing", async () => {
    store.findQuestByCode.mockResolvedValue({ id: ID, code: "A2C4EF" });
    expect(await submit(["u1"])).toEqual({
      error: "This form is out of date. Reload and try again.",
    });
    store.findQuestByCode.mockResolvedValue(null);
    expect((await submit(["u1"])).error).toMatch(/out of date/);
    expect(store.confirmQuest).not.toHaveBeenCalled();
  });

  it("keeps the whole player list on the board with the result", async () => {
    store.confirmQuest.mockResolvedValue({ status: "ok" });
    await expect(submit(["u1"], ID, "u1,u3")).rejects.toThrow(
      `REDIRECT /backstage/megagame?quest=A2C4EF&players=u1%2Cu3&c=${ID}`,
    );
  });

  it("keeps the level-up, recent, range and bucket choices on the board", async () => {
    store.confirmQuest.mockResolvedValue({ status: "ok" });
    await expect(
      submit(
        ["u1"],
        ID,
        "u1",
        "quest=ZZZZZZ&players=u9&c=old&levelup=u2&recent=60&range=7d&bucket=hour",
      ),
    ).rejects.toThrow(
      `REDIRECT /backstage/megagame?quest=A2C4EF&players=u1&c=${ID}&levelup=u2&recent=60&range=7d&bucket=hour`,
    );
  });

  it("records as the signed-in volunteer and opens the result by its id", async () => {
    store.confirmQuest.mockResolvedValue({ status: "ok" });
    await expect(submit(["u1", "u2"])).rejects.toThrow(
      `REDIRECT /backstage/megagame?quest=A2C4EF&c=${ID}`,
    );
    expect(store.confirmQuest).toHaveBeenCalledWith({
      id: ID,
      questId: QUEST,
      requestedUserIds: ["u1", "u2"],
      confirmedBy: "v1",
    });
  });

  it("refuses a malformed id before writing", async () => {
    expect(await submit(["u1"], "not-a-uuid")).toEqual({
      error: "This form is out of date. Reload and try again.",
    });
    expect(store.confirmQuest).not.toHaveBeenCalled();
  });

  it("explains each refusal from the store", async () => {
    store.confirmQuest.mockResolvedValueOnce({ status: "no-players" });
    expect(await submit([])).toEqual({ error: "Add at least one player." });
    store.confirmQuest.mockResolvedValueOnce({ status: "voided" });
    expect((await submit(["u1"])).error).toMatch(/undone/);
    store.confirmQuest.mockResolvedValueOnce({ status: "players-mismatch" });
    expect((await submit(["u1"])).error).toMatch(/out of date/);
  });
});

describe("undoConfirmation", () => {
  const outcome = (confirmedBy: string) => ({
    status: "ok",
    confirmation: { id: ID, confirmedBy },
  });

  it("lets the confirming volunteer undo, with the reason", async () => {
    store.confirmationOutcome.mockResolvedValue(outcome("v1"));
    store.voidConfirmation.mockResolvedValue(true);
    expect(
      await undoConfirmation({}, form({ id: ID, reason: " wrong quest " })),
    ).toEqual({ done: true });
    expect(store.voidConfirmation).toHaveBeenCalledWith({
      id: ID,
      voidedBy: "v1",
      reason: "wrong quest",
    });
  });

  it("refuses another volunteer's confirmation without megagame.manage", async () => {
    store.confirmationOutcome.mockResolvedValue(outcome("v2"));
    expect((await undoConfirmation({}, form({ id: ID }))).error).toMatch(
      /only the volunteer who recorded it/i,
    );
    expect(store.voidConfirmation).not.toHaveBeenCalled();
  });

  it("lets megagame.manage undo anyone's confirmation", async () => {
    holds("megagame.verify", "megagame.manage");
    store.confirmationOutcome.mockResolvedValue(outcome("v2"));
    store.voidConfirmation.mockResolvedValue(true);
    expect(await undoConfirmation({}, form({ id: ID }))).toEqual({
      done: true,
    });
    expect(store.voidConfirmation).toHaveBeenCalledWith({
      id: ID,
      voidedBy: "v1",
      reason: null,
    });
  });

  it("reports an unknown confirmation", async () => {
    store.confirmationOutcome.mockResolvedValue(null);
    expect((await undoConfirmation({}, form({ id: ID }))).error).toMatch(
      /not found/i,
    );
  });
});

describe("undoCompletion", () => {
  it("needs megagame.manage", async () => {
    expect(await undoCompletion({}, form({ id: ID }))).toEqual({
      error: auth.EXPIRED,
    });
    expect(store.voidCompletion).not.toHaveBeenCalled();
    holds("megagame.verify", "megagame.manage");
    store.voidCompletion.mockResolvedValue(true);
    expect(await undoCompletion({}, form({ id: ID, reason: "dup" }))).toEqual({
      done: true,
    });
    expect(store.voidCompletion).toHaveBeenCalledWith({
      id: ID,
      voidedBy: "v1",
      reason: "dup",
    });
  });

  it("reports a completion that is unknown or already undone", async () => {
    holds("megagame.verify", "megagame.manage");
    store.voidCompletion.mockResolvedValue(false);
    expect((await undoCompletion({}, form({ id: ID }))).error).toMatch(
      /not found or already undone/i,
    );
  });
});

describe("levelUp", () => {
  const submit = (extra: Record<string, string | File> = {}) =>
    levelUp(
      {},
      form({ id: ID, userId: "u1", class: "wizard", level: "2", ...extra }),
    );

  beforeEach(() => {
    store.findLevelEvent.mockResolvedValue(null);
    store.playersByIds.mockResolvedValue([ada]);
    store.completionsInClass.mockResolvedValue(0);
    store.recordLevelUp.mockResolvedValue({ status: "awarded" });
  });

  it("records a level that passes every check", async () => {
    expect(await submit()).toEqual({
      awarded: { eventId: ID, class: "wizard", level: 2 },
    });
    expect(store.recordLevelUp).toHaveBeenCalledWith({
      id: ID,
      userId: "u1",
      class: "wizard",
      level: 2,
      awardedBy: "v1",
      checksPassed: true,
      overrideReason: null,
      cardPhotoUrl: null,
      note: null,
    });
  });

  it("refuses a level that is not above the current one, even when sure", async () => {
    expect(await submit({ level: "1", sure: "on" })).toEqual({
      error: "Already a level 1 wizard; a new level must be higher.",
    });
    expect(store.recordLevelUp).not.toHaveBeenCalled();
  });

  it("refuses a level above the maximum", async () => {
    expect((await submit({ level: "6", sure: "on" })).error).toBe(
      "Level 6 is above the maximum of 5.",
    );
  });

  it("asks for Yes, I'm sure when a check fails, and writes nothing", async () => {
    expect(await submit({ level: "3" })).toEqual({
      warnings: ["Skips level 2."],
    });
    expect(store.recordLevelUp).not.toHaveBeenCalled();
  });

  it("records anyway when sure, with the override reason", async () => {
    await submit({ level: "3", sure: "on", reason: "Card game win" });
    expect(store.recordLevelUp).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 3,
        checksPassed: false,
        overrideReason: "Card game win",
      }),
    );
  });

  it("uploads an optional record-card photo", async () => {
    blob.uploadImage.mockResolvedValue("https://b.test/card.webp");
    const photo = new File(["x"], "card.webp", { type: "image/webp" });
    await submit({ photo });
    expect(blob.uploadImage).toHaveBeenCalledWith(
      "megagame-cards",
      photo,
      blob.LARGE_IMAGE_MAX_BYTES,
    );
    expect(store.recordLevelUp).toHaveBeenCalledWith(
      expect.objectContaining({ cardPhotoUrl: "https://b.test/card.webp" }),
    );
  });

  it("ignores an empty file input", async () => {
    await submit({
      photo: new File([], "", { type: "application/octet-stream" }),
    });
    expect(blob.uploadImage).not.toHaveBeenCalled();
  });

  it("passes a retry of a recorded event straight to the store, skipping the checks", async () => {
    store.findLevelEvent.mockResolvedValue({ id: ID });
    store.playersByIds.mockResolvedValue([
      { ...ada, levels: { wizard: 2, pirate: 0, alien: 0 } },
    ]);
    store.recordLevelUp.mockResolvedValue({ status: "retry" });
    expect(await submit()).toEqual({
      awarded: { eventId: ID, class: "wizard", level: 2 },
    });
  });

  it("does not upload the photo again on a retry", async () => {
    store.findLevelEvent.mockResolvedValue({ id: ID });
    store.recordLevelUp.mockResolvedValue({ status: "retry" });
    await submit({
      photo: new File(["x"], "card.webp", { type: "image/webp" }),
    });
    expect(blob.uploadImage).not.toHaveBeenCalled();
    expect(store.recordLevelUp).toHaveBeenCalledWith(
      expect.objectContaining({ cardPhotoUrl: null }),
    );
  });

  it("refuses an unknown player", async () => {
    store.playersByIds.mockResolvedValue([]);
    expect((await submit()).error).toMatch(/no such player/i);
    expect(store.recordLevelUp).not.toHaveBeenCalled();
  });

  it("explains a level another volunteer already recorded", async () => {
    store.recordLevelUp.mockResolvedValue({ status: "already-awarded" });
    expect((await submit()).error).toMatch(/already recorded/);
  });
});

describe("undoLevelUp", () => {
  it("lets the awarding volunteer undo their level-up", async () => {
    store.findLevelEvent.mockResolvedValue({ id: ID, awardedBy: "v1" });
    store.voidLevelEvent.mockResolvedValue({ status: "voided", level: 1 });
    expect(await undoLevelUp({}, form({ id: ID }))).toEqual({ done: true });
    expect(store.voidLevelEvent).toHaveBeenCalledWith({
      id: ID,
      voidedBy: "v1",
      reason: null,
    });
  });

  it("refuses another volunteer's level-up without megagame.manage", async () => {
    store.findLevelEvent.mockResolvedValue({ id: ID, awardedBy: "v2" });
    expect((await undoLevelUp({}, form({ id: ID }))).error).toMatch(
      /only the volunteer who recorded it/i,
    );
    expect(store.voidLevelEvent).not.toHaveBeenCalled();
  });

  it("refuses a picker join", async () => {
    holds("megagame.verify", "megagame.manage");
    store.findLevelEvent.mockResolvedValue({ id: ID, awardedBy: "u1" });
    store.voidLevelEvent.mockResolvedValue({ status: "not-volunteer" });
    expect((await undoLevelUp({}, form({ id: ID }))).error).toMatch(
      /faction picker/,
    );
  });
});

describe("logAnswerAttempt", () => {
  const quest = {
    id: QUEST,
    code: "A2C4EF",
    kind: "answer",
    answers: ["Fire", "Flame"],
  };

  it("needs megagame.verify and writes nothing without it", async () => {
    holds();
    expect(await logAnswerAttempt("A2C4EF", "fire")).toEqual({
      error: auth.EXPIRED,
    });
    expect(store.findQuestByCode).not.toHaveBeenCalled();
    expect(store.recordQuestAttempt).not.toHaveBeenCalled();
  });

  it("records the answer as typed, judged against the stored answers", async () => {
    store.findQuestByCode.mockResolvedValue(quest);
    expect(await logAnswerAttempt("A2C4EF", "  FLAME! ")).toEqual({
      correct: true,
    });
    expect(store.recordQuestAttempt).toHaveBeenCalledWith({
      questId: QUEST,
      enteredBy: "v1",
      enteredAnswer: "FLAME!",
      correct: true,
    });
  });

  it("records a wrong answer as incorrect", async () => {
    store.findQuestByCode.mockResolvedValue(quest);
    expect(await logAnswerAttempt("A2C4EF", "water")).toEqual({
      correct: false,
    });
    expect(store.recordQuestAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ enteredAnswer: "water", correct: false }),
    );
  });

  it("skips blank input and answers with nothing to match", async () => {
    store.findQuestByCode.mockResolvedValue(quest);
    expect(await logAnswerAttempt("A2C4EF", " -- ")).toEqual({});
    expect(store.recordQuestAttempt).not.toHaveBeenCalled();
  });

  it("cuts an over-long answer before storing it", async () => {
    store.findQuestByCode.mockResolvedValue(quest);
    await logAnswerAttempt("A2C4EF", "x".repeat(1000));
    const [row] = store.recordQuestAttempt.mock.calls[0];
    expect(row.enteredAnswer).toHaveLength(200);
  });

  it("refuses an unknown quest or one checked by evidence", async () => {
    store.findQuestByCode.mockResolvedValue(null);
    expect(await logAnswerAttempt("A2C4EF", "fire")).toEqual({
      error: "That quest was not found.",
    });
    store.findQuestByCode.mockResolvedValue({ ...quest, kind: "evidence" });
    expect(await logAnswerAttempt("A2C4EF", "fire")).toEqual({
      error: "That quest was not found.",
    });
    expect(store.recordQuestAttempt).not.toHaveBeenCalled();
  });

  it("normalizes the quest code and skips the lookup for a malformed one", async () => {
    store.findQuestByCode.mockResolvedValue(quest);
    await logAnswerAttempt("a2c4-ef", "fire");
    expect(store.findQuestByCode).toHaveBeenCalledWith("A2C4EF");
    store.findQuestByCode.mockClear();
    expect(await logAnswerAttempt("x".repeat(500), "fire")).toEqual({
      error: "That quest was not found.",
    });
    expect(store.findQuestByCode).not.toHaveBeenCalled();
  });

  it("refuses input that is not a string", async () => {
    store.findQuestByCode.mockResolvedValue(quest);
    expect(
      await logAnswerAttempt("A2C4EF", { toString: () => "fire" } as never),
    ).toEqual({ error: "This form is out of date. Reload and try again." });
    expect(store.recordQuestAttempt).not.toHaveBeenCalled();
  });
});
