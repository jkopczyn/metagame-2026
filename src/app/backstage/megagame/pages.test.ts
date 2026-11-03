import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, store, data, nav } = vi.hoisted(() => ({
  auth: { toolAccess: vi.fn(), requireAccess: vi.fn(), EXPIRED: "expired" },
  store: { findPlayerByCode: vi.fn() },
  data: {
    loadPlayerRows: vi.fn(),
    loadQuest: vi.fn(),
    loadConfirmation: vi.fn(),
    loadLevelUpTarget: vi.fn(),
    loadListedPlayers: vi.fn(),
    loadRecentActions: vi.fn(),
    loadOverTime: vi.fn(),
  },
  nav: {
    redirect: vi.fn((to: string) => {
      throw new Error(`REDIRECT ${to}`);
    }),
  },
}));
vi.mock("@/lib/admin-auth", () => auth);
vi.mock("@/lib/megagame-store", () => store);
vi.mock("./data", () => data);
vi.mock("./actions", () => ({}));
vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("next/navigation", () => nav);

import SignIn from "../SignIn";
import QuestBoard from "./page";
import QuestSection from "./QuestSection";

const C = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const props = (searchParams: Record<string, string>) =>
  ({
    params: Promise.resolve({}),
    searchParams: Promise.resolve(searchParams),
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  auth.toolAccess.mockResolvedValue(null);
});

const expectSignInOnly = (el: unknown, next: string) => {
  expect(el).toMatchObject({ type: SignIn, props: { next } });
  for (const fn of [...Object.values(store), ...Object.values(data)])
    expect(fn).not.toHaveBeenCalled();
};

describe("Quest Board without megagame.verify", () => {
  it("shows only the sign-in, keeping the quest, list and confirmation", async () => {
    const el = await QuestBoard(
      props({ quest: "a2c4ef", players: "u1,u2", c: C }),
    );
    expect(auth.toolAccess).toHaveBeenCalledWith("megagame.verify");
    expectSignInOnly(
      el,
      `/backstage/megagame?quest=A2C4EF&players=u1%2Cu2&c=${C}`,
    );
  });

  it("drops a malformed confirmation id and keeps a badge code", async () => {
    const el = await QuestBoard(props({ c: "nope", player: "b3d5f7" }));
    expectSignInOnly(el, "/backstage/megagame?player=b3d5f7");
  });
});

describe("Quest Board for a volunteer", () => {
  beforeEach(() => {
    auth.toolAccess.mockImplementation(async (p: string) =>
      p === "megagame.verify" ? { name: "Vol", userId: "v1" } : null,
    );
  });

  it("adds a badge's player to the list and keeps the quest", async () => {
    store.findPlayerByCode.mockResolvedValue({ id: "u3" });
    await expect(
      QuestBoard(props({ quest: "A2C4EF", players: "u1", player: "b3d5f7" })),
    ).rejects.toThrow(
      "REDIRECT /backstage/megagame?quest=A2C4EF&players=u1%2Cu3",
    );
  });

  it("renders the four sections in order with the viewer's undo rights", async () => {
    const el = (await QuestBoard(props({ quest: "A2C4EF" }))) as {
      props: { children: unknown[] };
    };
    const sections = el.props.children.filter(Boolean) as {
      type: unknown;
      props: Record<string, unknown>;
    }[];
    expect(sections.map((s) => (s.type as { name: string }).name)).toEqual([
      "QuestSection",
      "LevelUpSection",
      "RecentActions",
      "OverTime",
    ]);
    expect(sections[0].props.viewer).toEqual({ userId: "v1", manager: false });
    expect(auth.toolAccess).toHaveBeenCalledWith("megagame.manage");
  });
});

const hrefs = (node: unknown): string[] => {
  if (Array.isArray(node)) return node.flatMap(hrefs);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const props = (node as { props: Record<string, unknown> }).props;
  return [
    ...(typeof props.href === "string" ? [props.href] : []),
    ...hrefs(props.children),
  ];
};

describe("Quest Board dashboard link", () => {
  it("is hidden from a volunteer without megagame.manage", async () => {
    auth.toolAccess.mockImplementation(async (p: string) =>
      p === "megagame.verify" ? { name: "Vol", userId: "v1" } : null,
    );
    const el = await QuestBoard(props({}));
    expect(hrefs(el)).not.toContain("/backstage/megagame/dashboard");
  });

  it("is shown to a manager", async () => {
    auth.toolAccess.mockResolvedValue({ name: "Boss", userId: "m1" });
    const el = await QuestBoard(props({}));
    expect(hrefs(el)).toContain("/backstage/megagame/dashboard");
  });
});

type Node = { type?: unknown; props?: Record<string, unknown> };

/** Element type names, text and component props in a rendered tree, without running child components. */
function walk(
  node: unknown,
  out = {
    types: [] as string[],
    text: "",
    props: [] as Record<string, unknown>[],
  },
) {
  if (typeof node === "string" || typeof node === "number") out.text += node;
  else if (Array.isArray(node)) for (const n of node) walk(n, out);
  else if (node && typeof node === "object") {
    const { type, props } = node as Node;
    if (typeof type === "function") {
      out.types.push(type.name);
      if (props) out.props.push(props);
    }
    if (props) walk(props.children, out);
  }
  return out;
}

describe("QuestSection", () => {
  const viewer = { userId: "v1", manager: false };
  const params = (
    quest: string | null,
    confirmation: string | null = null,
  ) => ({
    quest,
    players: [],
    confirmation,
    levelUp: null,
    recent: 30,
    range: null,
    bucket: null,
  });

  it("loads no quest without a code", async () => {
    data.loadPlayerRows.mockResolvedValue([]);
    await QuestSection({ params: params(null), viewer, notice: null });
    expect(data.loadQuest).not.toHaveBeenCalled();
  });

  it("does not open an inactive quest", async () => {
    data.loadQuest.mockResolvedValue({
      status: "inactive",
      quest: { id: "q1", code: "A2C4EF", title: "Riddle", active: false },
    });
    const el = await QuestSection({
      params: params("A2C4EF"),
      viewer,
      notice: null,
    });
    const found = walk(el);
    expect(found.text).toContain(" is not active, so it can");
    expect(found.types).toContain("PlayerList");
    expect(found.types).not.toContain("CheckAndConfirm");
    expect(found.props.find((p) => "quest" in p && p.quest !== null)).toBe(
      undefined,
    );
  });
});
