import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, data, nav } = vi.hoisted(() => ({
  auth: { toolAccess: vi.fn(), requireAccess: vi.fn(), EXPIRED: "expired" },
  data: {
    loadPlayerRows: vi.fn(),
    loadQuest: vi.fn(),
    loadCompletionResult: vi.fn(),
    loadLevelUpTarget: vi.fn(),
    loadListedPlayers: vi.fn(),
    loadRecentActions: vi.fn(),
  },
  nav: {
    redirect: vi.fn((to: string) => {
      throw new Error(`REDIRECT ${to}`);
    }),
  },
}));
vi.mock("@/lib/admin-auth", () => auth);
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
  for (const fn of Object.values(data)) expect(fn).not.toHaveBeenCalled();
};

describe("Quest Board without megagame.verify", () => {
  it("shows only the sign-in, keeping the quest, list and recorded rows", async () => {
    const el = await QuestBoard(
      props({ quest: "a2c4ef", players: "u1,u2", done: C }),
    );
    expect(auth.toolAccess).toHaveBeenCalledWith("megagame.verify");
    expectSignInOnly(
      el,
      `/backstage/megagame?quest=A2C4EF&players=u1%2Cu2&done=${C}`,
    );
  });

  it("drops a malformed recorded row id", async () => {
    const el = await QuestBoard(props({ done: "nope" }));
    expectSignInOnly(el, "/backstage/megagame?done=");
  });
});

describe("Quest Board for a volunteer", () => {
  beforeEach(() => {
    auth.toolAccess.mockImplementation(async (p: string) =>
      p === "megagame.verify" ? { name: "Vol", userId: "v1" } : null,
    );
  });

  it("renders the three sections in order with the viewer's undo rights", async () => {
    type Node = { type: unknown; props: Record<string, unknown> };
    const el = (await QuestBoard(props({ quest: "A2C4EF" }))) as {
      props: { children: Node[] };
    };
    // The first two sections sit in a grid of wrapper divs on wide screens.
    const unwrap = (n: Node): Node[] =>
      typeof n.type === "string"
        ? ([n.props.children] as (Node | Node[])[]).flat().flatMap(unwrap)
        : [n];
    const sections = el.props.children.flatMap(unwrap);
    expect(sections.map((s) => (s.type as { name: string }).name)).toEqual([
      "QuestSection",
      "LevelUpSection",
      "RecentActions",
    ]);
    expect(sections[0].props.viewer).toEqual({ userId: "v1", manager: false });
    expect(auth.toolAccess).toHaveBeenCalledWith("megagame.manage");
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
  const params = (quest: string | null, done: string[] | null = null) => ({
    quest,
    players: [],
    done,
    levelUp: null,
    recent: 30,
  });

  it("loads no quest without a code", async () => {
    data.loadPlayerRows.mockResolvedValue([]);
    await QuestSection({ params: params(null), viewer });
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
    });
    const found = walk(el);
    expect(found.text).toContain(" is not active, so it can");
    expect(found.types).toContain("PlayerList");
    expect(found.types).not.toContain("CheckAndConfirm");
    expect(found.props.find((p) => "quest" in p && p.quest !== null)).toBe(
      undefined,
    );
  });

  it("shows the result with the recorded row ids, even once the quest is withdrawn", async () => {
    data.loadQuest.mockResolvedValue({
      status: "inactive",
      quest: { id: "q1", code: "A2C4EF", title: "Riddle", active: false },
    });
    const el = await QuestSection({ params: params("A2C4EF", [C]), viewer });
    const found = walk(el);
    expect(found.types).toContain("CompletionResult");
    expect(found.types).not.toContain("CheckAndConfirm");
    expect(found.props.find((p) => "done" in p)?.done).toEqual([C]);
  });
});
