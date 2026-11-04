import { beforeEach, describe, expect, it, vi } from "vitest";
import { teamAccess } from "@/lib/access";
import { currentSession } from "@/lib/auth";
import { listNotesIn } from "@/lib/unconference-store";
import { loadPageSnapshot, loadScheduleSnapshot } from "./data";

vi.mock("@/lib/access", () => ({ teamAccess: vi.fn() }));
vi.mock("@/lib/auth", () => ({ currentSession: vi.fn() }));
vi.mock("@/lib/ticket-store", () => ({}));
vi.mock("@/lib/unconference-store", () => ({
  listNotesIn: vi.fn(async () => []),
}));
vi.mock("@/lib/schedule-store", () => ({
  loadSchedule: async () => ({
    locations: [
      { id: "open", visibility: "public", boardStartsAt: "x" },
      { id: "crew", visibility: "volunteer", boardStartsAt: "x" },
      { id: "team", visibility: "hidden", boardStartsAt: "x" },
    ],
    sessions: [],
  }),
  loadViewerPlans: async () => ({ rsvps: {}, bookmarks: [] }),
}));

const signedIn = (permissions: string[]) => {
  const session = { user: { id: "me", banned: false } };
  vi.mocked(currentSession).mockResolvedValue(session as never);
  vi.mocked(teamAccess).mockResolvedValue(
    (permissions.length
      ? { session, permissions: new Set(permissions) }
      : null) as never,
  );
};

describe("loadScheduleSnapshot", () => {
  beforeEach(() => vi.clearAllMocks());

  it("checks access once, since a route handler has no render to memoize in", async () => {
    signedIn(["unconference.post"]);
    await loadScheduleSnapshot();
    expect(teamAccess).toHaveBeenCalledTimes(1);
    expect(currentSession).toHaveBeenCalledTimes(1);
  });

  it.each([
    [[], ["open"]],
    [["schedule.volunteer_rooms"], ["open", "crew"]],
    [["schedule.manage"], ["open", "crew", "team"]],
  ])("with %j shows and reads notes only in %j", async (permissions, rooms) => {
    signedIn(permissions);
    const { locations } = await loadScheduleSnapshot();
    expect(locations.map((l) => l.id)).toEqual(rooms);
    expect(listNotesIn).toHaveBeenCalledWith(rooms, "me");
  });

  it("says what the viewer may do on the board", async () => {
    signedIn(["schedule.manage", "unconference.post"]);
    const { board, mine } = await loadScheduleSnapshot();
    expect(board).toMatchObject({
      signedIn: true,
      canPost: true,
      isTeam: true,
    });
    expect(mine).toEqual([]);
  });

  it("reads the same on the first render as on a re-read", async () => {
    signedIn(["schedule.manage", "unconference.post"]);
    expect(await loadPageSnapshot()).toEqual({
      ...(await loadScheduleSnapshot()),
      readAt: expect.any(Number),
    });
  });

  it("gives a signed-out viewer no plans and no way to post", async () => {
    vi.mocked(currentSession).mockResolvedValue(null);
    vi.mocked(teamAccess).mockResolvedValue(null);
    const { board, mine } = await loadScheduleSnapshot();
    expect(mine).toBeNull();
    expect(board).toMatchObject({
      signedIn: false,
      canPost: false,
      isTeam: false,
    });
    expect(listNotesIn).toHaveBeenCalledWith(["open"], null);
  });
});
