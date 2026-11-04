import { beforeEach, expect, it, vi } from "vitest";
import { APIError } from "better-auth/api";

const h = vi.hoisted(() => ({
  headers: new Headers(),
  session: null as null | { user: { id: string }; session: object },
  signInEmail: vi.fn(),
  signInEmailOTP: vi.fn(),
  setPassword: vi.fn(),
  sendVerificationOTP: vi.fn(),
  codeDelivered: vi.fn(),
  replacePassword: vi.fn(),
  hasPassword: vi.fn(),
  begin: vi.fn(),
  attempt: { succeeded: vi.fn(), release: vi.fn() },
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));

vi.mock("next/headers", () => ({ headers: async () => h.headers }));
vi.mock("next/navigation", () => ({ redirect: h.redirect }));
vi.mock("@/db", () => ({ getDb: vi.fn(), schema: { user: {} } }));
vi.mock("@/lib/auth", () => ({
  API_KEY_HEADER: "x-api-key",
  codeDelivered: h.codeDelivered,
  currentSession: async () => h.session,
  hasPassword: h.hasPassword,
  replacePassword: h.replacePassword,
  getAuth: () => ({
    api: {
      signInEmail: h.signInEmail,
      signInEmailOTP: h.signInEmailOTP,
      setPassword: h.setPassword,
      sendVerificationOTP: h.sendVerificationOTP,
    },
  }),
}));
vi.mock("@/lib/login-throttle", () => ({
  beginLoginAttempt: h.begin,
  MAX_EMAIL_LENGTH: 254,
  clientIp: () => "203.0.113.7",
}));

import { authenticate, type AuthState } from "./actions";

const EMAIL = "ada@example.com";
const prev: AuthState = { step: "email", email: EMAIL };
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  data.set("email", EMAIL);
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.headers = new Headers();
  h.session = null;
  h.begin.mockResolvedValue(h.attempt);
  h.codeDelivered.mockResolvedValue(true);
});

it("doesn't check a password once the throttle refuses", async () => {
  h.begin.mockResolvedValue(null);
  const state = await authenticate(
    prev,
    form({ intent: "password", password: "guess" }),
  );
  expect(h.begin).toHaveBeenCalledWith("password", EMAIL, "203.0.113.7");
  expect(h.signInEmail).not.toHaveBeenCalled();
  expect(state.step).toBe("password");
  expect(state.error).toContain("Email yourself a code");
});

it("leaves a wrong password counted and clears a right one", async () => {
  h.signInEmail.mockRejectedValueOnce(
    new APIError("UNAUTHORIZED", { code: "INVALID_EMAIL_OR_PASSWORD" }),
  );
  const wrong = await authenticate(
    prev,
    form({ intent: "password", password: "guess" }),
  );
  expect(wrong.error).toContain("didn't match");
  expect(h.attempt.succeeded).not.toHaveBeenCalled();
  expect(h.attempt.release).not.toHaveBeenCalled();

  h.signInEmail.mockResolvedValueOnce({});
  await expect(
    authenticate(prev, form({ intent: "password", password: "right" })),
  ).rejects.toThrow("redirect:/account");
  expect(h.attempt.succeeded).toHaveBeenCalledTimes(1);
});

it("doesn't count an unverified address's password as a failure", async () => {
  h.signInEmail.mockRejectedValueOnce(
    new APIError("FORBIDDEN", { code: "EMAIL_NOT_VERIFIED" }),
  );
  const state = await authenticate(
    prev,
    form({ intent: "password", password: "right" }),
  );
  expect(state.step).toBe("code");
  expect(h.attempt.release).toHaveBeenCalledTimes(1);
});

it.each([
  ["a database error", new Error("connection reset")],
  [
    "a session that couldn't be created",
    new APIError("UNAUTHORIZED", { code: "FAILED_TO_CREATE_SESSION" }),
  ],
])("doesn't call %s a wrong password or count it", async (_label, error) => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  h.signInEmail.mockRejectedValueOnce(error);
  const state = await authenticate(
    prev,
    form({ intent: "password", password: "right" }),
  );
  expect(state.step).toBe("password");
  expect(state.error).toContain("Try again");
  expect(state.error).not.toContain("didn't match");
  expect(h.attempt.release).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalled();
  log.mockRestore();
});

it("doesn't check a code once the throttle refuses", async () => {
  h.begin.mockResolvedValue(null);
  const state = await authenticate(
    prev,
    form({ intent: "verify", code: "123456" }),
  );
  expect(h.begin).toHaveBeenCalledWith("code", EMAIL, "203.0.113.7");
  expect(h.signInEmailOTP).not.toHaveBeenCalled();
  expect(state).toMatchObject({ step: "code" });
  expect(state.error).toContain("Too many tries");
});

it("doesn't spend a try on a malformed code", async () => {
  await authenticate(prev, form({ intent: "verify", code: "12" }));
  expect(h.begin).not.toHaveBeenCalled();
});

it("clears the failures on a right code", async () => {
  h.signInEmailOTP.mockResolvedValueOnce({ user: { id: "u1" } });
  h.hasPassword.mockResolvedValueOnce(true);
  const state = await authenticate(
    prev,
    form({ intent: "verify", code: "123456" }),
  );
  expect(h.attempt.succeeded).toHaveBeenCalledTimes(1);
  expect(state).toMatchObject({ step: "set-password", replacing: true });
});

it.each([
  ["INVALID_OTP", "didn't match"],
  ["OTP_EXPIRED", "expired"],
  ["TOO_MANY_ATTEMPTS", "Too many tries"],
])("leaves a code refused with %s counted", async (code, message) => {
  h.signInEmailOTP.mockRejectedValueOnce(new APIError("BAD_REQUEST", { code }));
  const state = await authenticate(
    prev,
    form({ intent: "verify", code: "123456" }),
  );
  expect(state.error).toContain(message);
  expect(h.attempt.succeeded).not.toHaveBeenCalled();
  expect(h.attempt.release).not.toHaveBeenCalled();
});

it("doesn't call a database error a wrong code or count it", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  h.signInEmailOTP.mockRejectedValueOnce(new Error("connection reset"));
  const state = await authenticate(
    prev,
    form({ intent: "verify", code: "123456" }),
  );
  expect(state.step).toBe("code");
  expect(state.error).toContain("Try again");
  expect(state.error).not.toContain("didn't match");
  expect(h.attempt.release).toHaveBeenCalledTimes(1);
  log.mockRestore();
});

it("stays on the email step with the error when the code email fails", async () => {
  h.codeDelivered.mockResolvedValue(false);
  const state = await authenticate(prev, form({ intent: "code" }));
  expect(state).toEqual({
    step: "email",
    email: EMAIL,
    error: "We couldn't send the email. Try again in a minute.",
  });
});

it("moves to the code step when the code email goes out", async () => {
  const state = await authenticate(prev, form({ intent: "code" }));
  expect(state).toMatchObject({ step: "code", email: EMAIL });
});

const setPassword = form({
  intent: "set-password",
  newPassword: "long enough",
  confirm: "long enough",
});

it("lets a fresh browser session replace a password", async () => {
  h.session = { user: { id: "u1" }, session: { createdAt: new Date() } };
  h.hasPassword.mockResolvedValue(true);
  h.replacePassword.mockResolvedValue(undefined);
  await authenticate(prev, setPassword).catch(() => {});
  expect(h.replacePassword).toHaveBeenCalledWith("u1", "long enough");
});

it("never treats an API key's session as fresh", async () => {
  h.headers = new Headers({ "x-api-key": "mg_key" });
  h.session = { user: { id: "u1" }, session: { createdAt: new Date() } };
  h.hasPassword.mockResolvedValue(true);
  const state = await authenticate(prev, setPassword);
  expect(state).toMatchObject({ step: "email" });
  expect(state.error).toContain("Sign in again");
  expect(h.replacePassword).not.toHaveBeenCalled();
  expect(h.setPassword).not.toHaveBeenCalled();
});
