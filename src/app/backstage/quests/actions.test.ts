import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, store, nav } = vi.hoisted(() => ({
  auth: { EXPIRED: "Your session expired. Reload.", requireAccess: vi.fn() },
  store: {
    createQuest: vi.fn(),
    updateQuest: vi.fn(),
    getQuest: vi.fn(),
    deleteQuest: vi.fn(),
    listQuests: vi.fn(),
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
  deleteQuest,
  importQuests,
  saveQuest,
  setQuestActive,
} from "./actions";

const ME = { name: "Vol", userId: "v1" };
const ID = "11111111-1111-4111-8111-111111111111";
const BLOB = "https://x.public.blob.vercel-storage.com/megagame-quests/a.webp";

const form = (fields: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields))
    for (const item of [v].flat()) f.append(k, item);
  return f;
};

const holds = (...perms: string[]) =>
  auth.requireAccess.mockImplementation(async (p: string) =>
    perms.includes(p) ? ME : null,
  );

const row = {
  id: ID,
  code: "A2C4EF",
  title: "Old",
  bodyText: "",
  bodyImages: [],
  class: null,
  minLevel: null,
  maxLevel: null,
  minPlayers: 1,
  stampsWizard: 0,
  stampsPirate: 0,
  stampsAlien: 0,
  stampsAny: 0,
  evidence: null,
  evidenceImage: null,
  hint: null,
  author: null,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  holds("megagame.manage");
});

describe("gating", () => {
  it("refuses everything without megagame.manage", async () => {
    holds("megagame.verify");
    expect(await saveQuest({}, form({ title: "T" }))).toEqual({
      errors: [auth.EXPIRED],
    });
    expect(await deleteQuest({}, form({ id: ID }))).toEqual({
      error: auth.EXPIRED,
    });
    expect(await setQuestActive({}, form({ id: ID, active: "0" }))).toEqual({
      error: auth.EXPIRED,
    });
    expect(await importQuests([], { skipDuplicates: true })).toEqual({
      error: auth.EXPIRED,
    });
    expect(store.createQuest).not.toHaveBeenCalled();
  });
});

describe("saveQuest", () => {
  it("creates a quest from the form and opens it", async () => {
    store.createQuest.mockResolvedValue({ ...row, id: ID });
    await expect(
      saveQuest(
        {},
        form({
          title: "Hoot",
          bodyText: "Find the owl.",
          bodyImages: [BLOB],
          class: "wizard",
          minLevel: "2",
          maxLevel: "",
          minPlayers: "3",
          stampsWizard: "2",
          stampsAny: "1",
          evidence: "AVIANNA",
          evidenceImage: BLOB,
          hint: "",
          author: " Tobias ",
          active: "on",
        }),
      ),
    ).rejects.toThrow(`REDIRECT /backstage/quests/${ID}?saved=1`);
    expect(store.createQuest).toHaveBeenCalledWith({
      title: "Hoot",
      bodyText: "Find the owl.",
      bodyImages: [BLOB],
      class: "wizard",
      minLevel: 2,
      maxLevel: null,
      minPlayers: 3,
      stamps: { wizard: 2, pirate: 0, alien: 0, any: 1 },
      evidence: "AVIANNA",
      evidenceImage: BLOB,
      hint: null,
      author: "Tobias",
      active: true,
    });
  });

  it("updates with an id and reads a missing checkbox as withdrawn", async () => {
    store.updateQuest.mockResolvedValue(row);
    await expect(
      saveQuest({}, form({ id: ID, title: "Hoot" })),
    ).rejects.toThrow("REDIRECT");
    expect(store.updateQuest).toHaveBeenCalledWith(
      ID,
      expect.objectContaining({ title: "Hoot", active: false }),
    );
  });

  it("returns the field problems instead of saving", async () => {
    expect(await saveQuest({}, form({ title: "", class: "druid" }))).toEqual({
      errors: ["title: required", 'class: unknown class "druid"'],
    });
    expect(store.createQuest).not.toHaveBeenCalled();
  });

  it("only takes pictures the tool uploaded", async () => {
    expect(
      await saveQuest(
        {},
        form({ title: "T", bodyImages: ["https://elsewhere.example/x.png"] }),
      ),
    ).toEqual({ errors: ["Pictures must be uploaded through the form."] });
  });

  it("says when the quest went away", async () => {
    store.updateQuest.mockResolvedValue(null);
    expect(await saveQuest({}, form({ id: ID, title: "T" }))).toEqual({
      errors: ["That quest no longer exists."],
    });
  });
});

describe("setQuestActive", () => {
  it("rewrites the row with active flipped", async () => {
    store.getQuest.mockResolvedValue({
      ...row,
      stampsPirate: 3,
      class: "pirate",
    });
    store.updateQuest.mockResolvedValue(row);
    expect(await setQuestActive({}, form({ id: ID, active: "0" }))).toEqual({});
    expect(store.updateQuest).toHaveBeenCalledWith(
      ID,
      expect.objectContaining({
        active: false,
        class: "pirate",
        stamps: { wizard: 0, pirate: 3, alien: 0, any: 0 },
      }),
    );
  });
});

describe("deleteQuest", () => {
  it("deletes and goes back to the list", async () => {
    store.deleteQuest.mockResolvedValue("deleted");
    await expect(deleteQuest({}, form({ id: ID }))).rejects.toThrow(
      "REDIRECT /backstage/quests?deleted=1",
    );
  });

  it("explains a quest with progress", async () => {
    store.deleteQuest.mockResolvedValue("has-progress");
    const result = await deleteQuest({}, form({ id: ID }));
    expect(result.error).toContain("Untick Active");
  });
});

describe("importQuests", () => {
  it("creates the good entries, skips duplicate titles and reports bad ones", async () => {
    store.listQuests.mockResolvedValue([{ ...row, title: "Hoot & Seek" }]);
    store.createQuest.mockImplementation(async (input) => ({
      ...row,
      id: `id-${input.title}`,
      code: "B3D5F7",
      title: input.title,
    }));
    const result = await importQuests(
      [
        { index: 0, quest: { title: "hoot-seek" } },
        { index: 1, quest: { title: "New one", bodyImages: [BLOB] } },
        { index: 2, quest: { title: "new  ONE!" } },
        { index: 3, quest: { title: "", class: "elf" } },
        {
          index: 4,
          quest: { title: "Bad pic", evidenceImage: "https://x.test/a.png" },
        },
      ],
      { skipDuplicates: true },
    );
    expect(result).toEqual({
      created: [
        { index: 1, title: "New one", id: "id-New one", code: "B3D5F7" },
      ],
      skipped: [
        { index: 0, title: "hoot-seek", reason: "same title as quest A2C4EF" },
        { index: 2, title: "new  ONE!", reason: "same title as entry 1" },
      ],
      errors: [
        {
          index: 3,
          title: "",
          error: 'title: required; class: unknown class "elf"',
        },
        { index: 4, title: "Bad pic", error: "pictures were not uploaded" },
      ],
    });
    expect(store.createQuest).toHaveBeenCalledTimes(1);
  });

  it("imports duplicates when asked", async () => {
    store.listQuests.mockResolvedValue([{ ...row, title: "Hoot" }]);
    store.createQuest.mockResolvedValue({ ...row, title: "Hoot" });
    const result = await importQuests(
      [{ index: 0, quest: { title: "Hoot" } }],
      {
        skipDuplicates: false,
      },
    );
    expect(result).toMatchObject({
      created: [{ index: 0, title: "Hoot" }],
      skipped: [],
    });
  });
});
