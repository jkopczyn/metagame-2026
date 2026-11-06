import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, order } = vi.hoisted(() => {
  const order: string[] = [];
  const store = {
    loadMegagameLevels: vi.fn(async () => ({ wizard: 0, pirate: 0, alien: 0 })),
    setMegagameLevels: vi.fn(async () => {
      order.push("set");
    }),
    recordPickerJoin: vi.fn(async () => {
      order.push("event");
    }),
    hasVolunteerLevelEvent: vi.fn(async () => false),
  };
  return { store, order };
});

const h = vi.hoisted(() => ({
  headers: new Headers(),
  requestReset: vi.fn(),
  changePassword: vi.fn(),
  setPassword: vi.fn(),
  codeDelivered: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: async () => h.headers }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/db", () => ({ getDb: vi.fn(), schema: {} }));
vi.mock("@/lib/auth", () => ({
  API_KEY_HEADER: "x-api-key",
  codeDelivered: h.codeDelivered,
  currentSession: async () => ({
    user: { id: "u1", email: "ada@example.com" },
    session: {},
  }),
  hasPassword: async () => false,
  getAuth: () => ({
    api: {
      requestPasswordResetEmailOTP: h.requestReset,
      changePassword: h.changePassword,
      setPassword: h.setPassword,
    },
  }),
}));
vi.mock("@/lib/blob", () => ({ deleteImage: vi.fn(), uploadImage: vi.fn() }));
vi.mock("@/lib/megagame-store", () => store);
vi.mock("@/lib/schedule-store", () => ({ invalidateSchedule: vi.fn() }));
vi.mock("@/v2/data/speakers", () => ({ isSpeakerAccount: vi.fn(() => false) }));
vi.mock("@/lib/ticket-store", () => ({ hasClaimedTicket: vi.fn() }));

import {
  chooseMegagameClass,
  savePassword,
  type PasswordState,
} from "./actions";

const prev: PasswordState = { mode: "password" };
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};
const change = form({
  intent: "change",
  newPassword: "long enough",
  confirm: "long enough",
});

beforeEach(() => {
  vi.clearAllMocks();
  h.headers = new Headers();
  h.codeDelivered.mockResolvedValue(true);
});

it("sets a first password from a browser session", async () => {
  expect(await savePassword(prev, change)).toMatchObject({ saved: true });
  expect(h.setPassword).toHaveBeenCalledTimes(1);
});

it("refuses every password change over an API key", async () => {
  h.headers = new Headers({ "x-api-key": "mg_key" });
  expect((await savePassword(prev, change)).error).toContain("Sign in");
  expect((await savePassword(prev, form({ intent: "send" }))).error).toContain(
    "Sign in",
  );
  expect(h.setPassword).not.toHaveBeenCalled();
  expect(h.changePassword).not.toHaveBeenCalled();
  expect(h.codeDelivered).not.toHaveBeenCalled();
});

it("stays put with the error when the reset email fails", async () => {
  h.codeDelivered.mockResolvedValue(false);
  const state = await savePassword(prev, form({ intent: "send" }));
  expect(state).toMatchObject({
    mode: "password",
    error: "We couldn't send the email. Try again.",
  });
});

it("moves to the code step when the reset email goes out", async () => {
  const state = await savePassword(prev, form({ intent: "send" }));
  expect(state.mode).toBe("code");
  expect(state.error).toBeUndefined();
});

const pick = (cls: string) => {
  const form = new FormData();
  form.set("class", cls);
  return chooseMegagameClass({}, form);
};

describe("chooseMegagameClass", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    order.length = 0;
  });

  it("writes the picker event before setting the levels", async () => {
    expect(await pick("pirate")).toEqual({});
    expect(store.recordPickerJoin).toHaveBeenCalledWith("u1", "pirate");
    expect(store.setMegagameLevels).toHaveBeenCalledWith("u1", {
      wizard: 0,
      pirate: 1,
      alien: 0,
    });
    expect(order).toEqual(["event", "set"]);
  });

  it("writes nothing when the player is already in that class", async () => {
    store.loadMegagameLevels.mockResolvedValueOnce({
      wizard: 0,
      pirate: 2,
      alien: 0,
    });
    await pick("pirate");
    expect(store.recordPickerJoin).not.toHaveBeenCalled();
    expect(store.setMegagameLevels).not.toHaveBeenCalled();
  });

  it("refuses an unknown class without writing", async () => {
    expect(await pick("sorcerer")).toEqual({ error: "Pick a class." });
    expect(store.recordPickerJoin).not.toHaveBeenCalled();
  });

  it("refuses once a volunteer has recorded a level, without writing", async () => {
    store.hasVolunteerLevelEvent.mockResolvedValueOnce(true);
    const result = await pick("alien");
    expect(result.error).toBeTruthy();
    expect(store.hasVolunteerLevelEvent).toHaveBeenCalledWith("u1");
    expect(store.recordPickerJoin).not.toHaveBeenCalled();
    expect(store.setMegagameLevels).not.toHaveBeenCalled();
  });

  it("refuses to reset a level above 1, which the picker never set", async () => {
    store.loadMegagameLevels.mockResolvedValueOnce({
      wizard: 2,
      pirate: 0,
      alien: 0,
    });
    const result = await pick("alien");
    expect(result.error).toBeTruthy();
    expect(store.recordPickerJoin).not.toHaveBeenCalled();
    expect(store.setMegagameLevels).not.toHaveBeenCalled();
  });

  it("still lets a player with only picker rows switch class", async () => {
    store.loadMegagameLevels.mockResolvedValueOnce({
      wizard: 1,
      pirate: 0,
      alien: 0,
    });
    expect(await pick("alien")).toEqual({});
    expect(store.recordPickerJoin).toHaveBeenCalledWith("u1", "alien");
    expect(store.setMegagameLevels).toHaveBeenCalledWith("u1", {
      wizard: 0,
      pirate: 0,
      alien: 1,
    });
  });
});
