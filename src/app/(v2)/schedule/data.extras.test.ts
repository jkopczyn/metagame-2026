import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  can: vi.fn(),
  currentSession: vi.fn(),
  reportErrorOnce: vi.fn(),
  loadSchedule: vi.fn(),
  loadViewerPlans: vi.fn(),
  listNotesIn: vi.fn(),
}));

vi.mock("@/lib/access", () => ({ can: mocks.can, teamAccess: vi.fn() }));
vi.mock("@/lib/auth", () => ({ currentSession: mocks.currentSession }));
vi.mock("@/lib/error-report", () => ({
  reportErrorOnce: mocks.reportErrorOnce,
}));
vi.mock("@/lib/first-signin", () => ({ ticketStep: vi.fn() }));
vi.mock("@/lib/schedule", () => ({
  hostsBoard: () => true,
  publicSchedule: () => ({ locations: [{ id: "board" }], sessions: [] }),
  viewerSessionIds: () => ["s1"],
}));
vi.mock("@/lib/schedule-store", () => ({
  loadSchedule: mocks.loadSchedule,
  loadViewerPlans: mocks.loadViewerPlans,
}));
vi.mock("@/lib/ticket-store", () => ({
  hasClaimedTicket: vi.fn(),
  ticketLabel: vi.fn(),
  ticketsForUser: vi.fn(),
}));
vi.mock("@/lib/unconference", () => ({ boardNote: vi.fn() }));
vi.mock("@/lib/unconference-store", () => ({
  listNotesIn: mocks.listNotesIn,
}));

import { loadBoard, loadMySessionIds } from "./data";

describe("the schedule's extras", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.can.mockResolvedValue(false);
    mocks.currentSession.mockResolvedValue({ user: { id: "u1" } });
    mocks.loadSchedule.mockResolvedValue({ locations: [], sessions: [] });
    mocks.loadViewerPlans.mockResolvedValue([]);
    mocks.listNotesIn.mockResolvedValue([]);
  });

  it("pass through when they load", async () => {
    await expect(loadBoard()).resolves.toMatchObject({ signedIn: true });
    await expect(loadMySessionIds()).resolves.toEqual(["s1"]);
    expect(mocks.reportErrorOnce).not.toHaveBeenCalled();
  });

  it("drop the board and report once when it can't load", async () => {
    mocks.listNotesIn.mockRejectedValue(new Error("Neon down"));
    await expect(loadBoard()).resolves.toBeNull();
    expect(mocks.reportErrorOnce).toHaveBeenCalledWith(
      "schedule-board",
      expect.objectContaining({ mention: false }),
    );
  });

  it("drop the viewer's plans and report once when they can't load", async () => {
    mocks.loadViewerPlans.mockRejectedValue(new Error("Neon down"));
    await expect(loadMySessionIds()).resolves.toBeNull();
    expect(mocks.reportErrorOnce).toHaveBeenCalledWith(
      "schedule-viewer's plans",
      expect.objectContaining({ mention: false }),
    );
  });
});
