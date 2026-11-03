import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, store } = vi.hoisted(() => ({
  auth: { toolAccess: vi.fn() },
  store: {
    liveCompletionLog: vi.fn(),
    liveLevelEventLog: vi.fn(),
    claimedTicketHolderIds: vi.fn(),
    progressPlayers: vi.fn(),
  },
}));
vi.mock("@/lib/admin-auth", () => auth);
vi.mock("@/lib/megagame-store", () => store);
vi.mock("next/server", () => ({ connection: vi.fn() }));

import SignIn from "../../SignIn";
import DashboardPage from "./page";

const props = (searchParams: Record<string, string>) =>
  ({
    params: Promise.resolve({}),
    searchParams: Promise.resolve(searchParams),
  }) as never;

const loadEmpty = () => {
  store.liveCompletionLog.mockResolvedValue([]);
  store.liveLevelEventLog.mockResolvedValue([]);
  store.claimedTicketHolderIds.mockResolvedValue([]);
  store.progressPlayers.mockResolvedValue([]);
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.toolAccess.mockResolvedValue(null);
});

const expectSignInOnly = (el: unknown, next: string) => {
  expect(el).toMatchObject({ type: SignIn, props: { next } });
  for (const fn of Object.values(store)) expect(fn).not.toHaveBeenCalled();
};

describe("dashboard page", () => {
  it("needs megagame.manage, keeps its choices through sign-in, and loads nothing without it", async () => {
    const el = await DashboardPage(props({ range: "con", bucket: "1h" }));
    expect(auth.toolAccess).toHaveBeenCalledWith("megagame.manage");
    expectSignInOnly(el, "/backstage/megagame/dashboard?range=con&bucket=1h");
  });

  it("is refused to a volunteer holding only megagame.verify", async () => {
    auth.toolAccess.mockImplementation(async (p: string) =>
      p === "megagame.verify" ? { name: "Vol", userId: "v1" } : null,
    );
    const el = await DashboardPage(props({}));
    expectSignInOnly(el, "/backstage/megagame/dashboard?range=today");
  });

  it("makes exactly four store requests: both logs, the holder ids, then the players behind them", async () => {
    auth.toolAccess.mockResolvedValue({ name: "Boss", userId: "m1" });
    loadEmpty();
    store.liveCompletionLog.mockResolvedValue([
      {
        userId: "u1",
        class: "wizard",
        confirmedAt: new Date("2026-11-06T18:00:00.000Z"),
      },
      {
        userId: null,
        class: null,
        confirmedAt: new Date("2026-11-06T19:00:00.000Z"),
      },
    ]);
    store.liveLevelEventLog.mockResolvedValue([
      {
        userId: "u2",
        class: "pirate",
        level: 1,
        source: "picker",
        awardedAt: new Date("2026-11-06T09:00:00.000Z"),
      },
    ]);
    await DashboardPage(props({ range: "con", bucket: "1d" }));
    expect(Object.keys(store).sort()).toEqual([
      "claimedTicketHolderIds",
      "liveCompletionLog",
      "liveLevelEventLog",
      "progressPlayers",
    ]);
    for (const fn of Object.values(store)) expect(fn).toHaveBeenCalledTimes(1);
    expect(store.progressPlayers).toHaveBeenCalledWith(["u1", "u2"]);
  });

  it("still renders when the range has too many buckets", async () => {
    auth.toolAccess.mockResolvedValue({ name: "Boss", userId: "m1" });
    loadEmpty();
    await expect(
      DashboardPage(props({ range: "con", bucket: "5m" })),
    ).resolves.toBeTruthy();
  });
});
