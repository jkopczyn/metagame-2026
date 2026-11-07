import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, store, accounts } = vi.hoisted(() => ({
  auth: { EXPIRED: "Your session expired. Reload.", requireAccess: vi.fn() },
  store: {
    deleteSteal: vi.fn(),
    eligibleThiefName: vi.fn(),
    loadSchedule: vi.fn(),
    recordSteal: vi.fn(),
    saveSchedule: vi.fn(),
  },
  accounts: { findCheckinAccounts: vi.fn() },
}));
vi.mock("@/lib/admin-auth", () => auth);
vi.mock("@/lib/hat-tricks-store", () => store);
vi.mock("@/lib/checkin-store", () => accounts);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  deleteStealAction,
  findThieves,
  recordStealAction,
  saveScheduleAction,
} from "./actions";

const ME = { name: "Vol", userId: "v1" };
const STEAL_ID = "11111111-1111-4111-8111-111111111111";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [key, value] of Object.entries(fields)) f.set(key, value);
  return f;
};

const SHIFT = JSON.stringify([
  {
    start: "2020-01-03T22:00:00.000Z",
    end: "2020-01-04T02:00:00.000Z",
    hats: ["wizard"],
  },
]);

beforeEach(() => {
  vi.resetAllMocks();
  auth.requireAccess.mockResolvedValue(ME);
  store.eligibleThiefName.mockResolvedValue("Thief");
  store.loadSchedule.mockResolvedValue({ raw: undefined, version: 0 });
  store.saveSchedule.mockResolvedValue(true);
});

describe("gating", () => {
  it("refuses every action without the Quest Board permission", async () => {
    auth.requireAccess.mockResolvedValue(null);
    const expired = { error: auth.EXPIRED };
    expect(await findThieves("ab")).toEqual(expired);
    expect(
      await recordStealAction({}, form({ hatId: "wizard", userId: "u1" })),
    ).toEqual(expired);
    expect(await deleteStealAction({}, form({ id: STEAL_ID }))).toEqual(
      expired,
    );
    expect(
      await saveScheduleAction(
        {},
        form({ draft: '{"rows":[],"end":""}', version: "0" }),
      ),
    ).toEqual(expired);
    expect(auth.requireAccess).toHaveBeenCalledWith("megagame.verify");
    expect(store.recordSteal).not.toHaveBeenCalled();
    expect(store.deleteSteal).not.toHaveBeenCalled();
    expect(store.saveSchedule).not.toHaveBeenCalled();
  });
});

describe("recordStealAction", () => {
  it("records against the signed-in recorder, at now by default", async () => {
    const res = await recordStealAction(
      {},
      form({ hatId: "tricorn", userId: "u1" }),
    );
    expect(res).toEqual({ done: "Thief stole the Pirate tricorn." });
    const [steal, recorder] = store.recordSteal.mock.calls[0];
    expect(steal).toMatchObject({ hatId: "tricorn", userId: "u1" });
    expect(steal.stolenAt).toBeInstanceOf(Date);
    expect(recorder).toBe("v1");
  });

  it("reads an entered time as Pacific", async () => {
    await recordStealAction(
      {},
      form({
        hatId: "tricorn",
        userId: "u1",
        stolenAt: "2020-01-03T14:00",
      }),
    );
    expect(store.recordSteal.mock.calls[0][0].stolenAt.toISOString()).toBe(
      "2020-01-03T22:00:00.000Z",
    );
  });

  it("warns, but records, when the hat wasn't on shift", async () => {
    store.loadSchedule.mockResolvedValue({ raw: SHIFT, version: 1 });
    const res = await recordStealAction(
      {},
      form({
        hatId: "crown",
        userId: "u1",
        stolenAt: "2020-01-03T14:00",
      }),
    );
    expect(res.warning).toContain("wasn't on shift");
    expect(store.recordSteal).toHaveBeenCalledOnce();
  });

  it("still reports success if the off-shift check can't read the schedule", async () => {
    store.loadSchedule.mockRejectedValue(new Error("network"));
    const res = await recordStealAction(
      {},
      form({ hatId: "tricorn", userId: "u1" }),
    );
    expect(res.done).toBeDefined();
    expect(res.error).toBeUndefined();
  });

  it.each([
    [{ hatId: "fedora", userId: "u1" }, "Pick which hat"],
    [{ hatId: "wizard" }, "Pick who"],
    [{ hatId: "wizard", userId: "u1", stolenAt: "soon" }, "isn't valid"],
    [
      { hatId: "wizard", userId: "u1", stolenAt: "2999-01-01T00:00" },
      "in the future",
    ],
  ])("rejects %j", async (fields, message) => {
    const res = await recordStealAction({}, form(fields));
    expect(res.error).toContain(message);
    expect(store.recordSteal).not.toHaveBeenCalled();
  });

  it("rejects a banned or missing account", async () => {
    store.eligibleThiefName.mockResolvedValue(null);
    const res = await recordStealAction(
      {},
      form({ hatId: "wizard", userId: "gone" }),
    );
    expect(res.error).toContain("can't be used");
    expect(store.recordSteal).not.toHaveBeenCalled();
  });
});

describe("saveScheduleAction", () => {
  const draft = JSON.stringify({
    rows: [
      { start: "2020-01-03T18:00", hats: ["saucer"] },
      { start: "2020-01-03T14:00", hats: ["wizard"] },
    ],
    end: "2020-01-03T22:00",
  });

  it("saves shifts in time order, each ending at the next start", async () => {
    const res = await saveScheduleAction({}, form({ draft, version: "3" }));
    expect(res).toEqual({ done: "Schedule saved." });
    const [json, version, by] = store.saveSchedule.mock.calls[0];
    expect(JSON.parse(json)).toEqual([
      {
        start: "2020-01-03T22:00:00.000Z",
        end: "2020-01-04T02:00:00.000Z",
        hats: ["wizard"],
      },
      {
        start: "2020-01-04T02:00:00.000Z",
        end: "2020-01-04T06:00:00.000Z",
        hats: ["saucer"],
      },
    ]);
    expect(version).toBe(3);
    expect(by).toBe("v1");
  });

  it("reports a stale version", async () => {
    store.saveSchedule.mockResolvedValue(false);
    const res = await saveScheduleAction({}, form({ draft, version: "3" }));
    expect(res.error).toContain("Someone else changed");
  });

  it.each([
    [
      { rows: [{ start: "", hats: ["wizard"] }], end: "2020-01-03T22:00" },
      "Shift 1 needs",
    ],
    [
      { rows: [{ start: "2020-01-03T14:00", hats: ["wizard"] }], end: "" },
      "The last shift's end needs",
    ],
    [
      {
        rows: [
          { start: "2020-01-03T14:00", hats: ["wizard"] },
          { start: "2020-01-03T14:00", hats: ["crown"] },
        ],
        end: "2020-01-03T22:00",
      },
      "Two shifts start",
    ],
    [
      {
        rows: [{ start: "2020-01-03T14:00", hats: [] }],
        end: "2020-01-03T22:00",
      },
      "hats must not be empty",
    ],
    [
      {
        rows: [{ start: "2020-01-03T14:00", hats: ["wizard"] }],
        end: "2020-01-03T13:00",
      },
      "end must be after start",
    ],
    [
      {
        rows: [{ start: "2020-01-03T14:00", hats: ["fedora"] }],
        end: "2020-01-03T22:00",
      },
      "unknown hat",
    ],
  ])("rejects %j", async (bad, message) => {
    const res = await saveScheduleAction(
      {},
      form({ draft: JSON.stringify(bad), version: "1" }),
    );
    expect(res.error).toContain(message);
    expect(store.saveSchedule).not.toHaveBeenCalled();
  });

  it("clears with an empty draft", async () => {
    await saveScheduleAction(
      {},
      form({ draft: '{"rows":[],"end":""}', version: "1" }),
    );
    expect(store.saveSchedule.mock.calls[0][0]).toBe("[]");
  });

  it("rejects a malformed draft", async () => {
    for (const bad of ["nope", "null", '{"rows":"x"}']) {
      const res = await saveScheduleAction(
        {},
        form({ draft: bad, version: "1" }),
      );
      expect(res.error).toBeDefined();
    }
    expect(store.saveSchedule).not.toHaveBeenCalled();
  });
});
