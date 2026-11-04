import { beforeEach, expect, it, vi } from "vitest";

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
vi.mock("@/lib/blob", () => ({}));
vi.mock("@/lib/megagame-levels", () => ({}));
vi.mock("@/lib/megagame-store", () => ({}));
vi.mock("@/lib/schedule-store", () => ({}));
vi.mock("@/v2/data/speakers", () => ({}));
vi.mock("@/lib/ticket-store", () => ({}));

import { savePassword, type PasswordState } from "./actions";

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
