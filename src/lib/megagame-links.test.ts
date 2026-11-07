import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, access } = vi.hoisted(() => ({
  auth: { currentSession: vi.fn() },
  access: { can: vi.fn() },
}));
vi.mock("@/lib/auth", () => auth);
vi.mock("@/lib/access", () => access);

import { questLinkTarget } from "./megagame-links";

const session = { user: { id: "u1" } };

beforeEach(() => {
  vi.clearAllMocks();
  auth.currentSession.mockResolvedValue(null);
  access.can.mockResolvedValue(null);
});

describe("questLinkTarget", () => {
  it("sends a volunteer to the quest on the board, code normalized", async () => {
    auth.currentSession.mockResolvedValue(session);
    access.can.mockResolvedValue(session);
    expect(await questLinkTarget("a2c-4ef")).toBe(
      "/backstage/megagame?quest=A2C4EF",
    );
    expect(access.can).toHaveBeenCalledWith("megagame.verify");
  });

  it("keeps a player list on the way to the board and through sign-in", async () => {
    expect(await questLinkTarget("A2C4EF", "u1,u2")).toBe(
      `/login?next=${encodeURIComponent("/q/A2C4EF?players=u1%2Cu2")}`,
    );
    auth.currentSession.mockResolvedValue(session);
    access.can.mockResolvedValue(session);
    expect(await questLinkTarget("A2C4EF", ["u1,u2"])).toBe(
      "/backstage/megagame?quest=A2C4EF&players=u1%2Cu2",
    );
  });

  it("sends a signed-out viewer to sign in and come back", async () => {
    expect(await questLinkTarget("A2C4EF")).toBe("/login?next=%2Fq%2FA2C4EF");
  });

  it("shows a signed-in viewer without the permission the explanation page", async () => {
    auth.currentSession.mockResolvedValue(session);
    expect(await questLinkTarget("A2C4EF")).toBeNull();
  });
});
