import { beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  handler: vi.fn(),
  begin: vi.fn(),
  attempt: { succeeded: vi.fn(), release: vi.fn() },
}));
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ handler: h.handler }) }));
vi.mock("@/lib/login-throttle", () => ({
  beginLoginAttempt: h.begin,
  MAX_EMAIL_LENGTH: 254,
  clientIp: () => "203.0.113.7",
}));

import { POST } from "./route";

const post = (path: string, body: unknown = {}) =>
  POST(
    new Request(`https://metagame.games/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
const signIn = { email: " Ada@Example.com", password: "metagame" };

beforeEach(() => {
  vi.clearAllMocks();
  h.begin.mockResolvedValue(h.attempt);
  h.handler.mockResolvedValue(new Response("{}", { status: 200 }));
});

it.each([
  "/api-key/create",
  "/api-key/list",
  "/update-user",
  "/change-password",
  "/set-password",
  "/admin/set-role",
  "/email-otp/send-verification-otp",
  "/sign-in/email-otp",
  "/sign-in/email/",
  "/sign-in/email/extra",
  "/sign-in%2Femail",
])("doesn't serve %s", async (path) => {
  expect((await post(path)).status).toBe(404);
  expect(h.handler).not.toHaveBeenCalled();
  expect(h.begin).not.toHaveBeenCalled();
});

it("serves password sign-in, counted against the same throttle", async () => {
  const response = await post("/sign-in/email", signIn);
  expect(response.status).toBe(200);
  expect(h.begin).toHaveBeenCalledWith(
    "password",
    "ada@example.com",
    "203.0.113.7",
  );
  expect(h.attempt.succeeded).toHaveBeenCalledTimes(1);
  // The body is still there for Better Auth to read.
  expect(await h.handler.mock.calls[0][0].json()).toEqual(signIn);
});

it("refuses without checking once the throttle is used up", async () => {
  h.begin.mockResolvedValue(null);
  expect((await post("/sign-in/email", signIn)).status).toBe(429);
  expect(h.handler).not.toHaveBeenCalled();
});

it("leaves a wrong password counted", async () => {
  const response = Response.json(
    { code: "INVALID_EMAIL_OR_PASSWORD" },
    { status: 401 },
  );
  h.handler.mockResolvedValue(response);
  const answered = await post("/sign-in/email", signIn);
  expect(answered.status).toBe(401);
  // Reading the code leaves the body for the client.
  expect(await answered.json()).toEqual({ code: "INVALID_EMAIL_OR_PASSWORD" });
  expect(h.attempt.succeeded).not.toHaveBeenCalled();
  expect(h.attempt.release).not.toHaveBeenCalled();
});

it.each([
  [401, '{"code":"FAILED_TO_CREATE_SESSION"}'],
  [403, '{"code":"EMAIL_NOT_VERIFIED"}'],
  [429, "{}"],
  [500, "not json"],
])(
  "doesn't count a %i %s, which isn't a verdict on the password",
  async (status, body) => {
    h.handler.mockResolvedValue(new Response(body, { status }));
    expect((await post("/sign-in/email", signIn)).status).toBe(status);
    expect(h.attempt.release).toHaveBeenCalledTimes(1);
  },
);

it("doesn't count a sign-in that throws", async () => {
  h.handler.mockRejectedValue(new Error("connection reset"));
  await expect(post("/sign-in/email", signIn)).rejects.toThrow(
    "connection reset",
  );
  expect(h.attempt.release).toHaveBeenCalledTimes(1);
});

it.each([
  ["a malformed body", "not json"],
  ["a missing email", { password: "x" }],
  ["an over-long email", { email: `${"a".repeat(300)}@x.co`, password: "x" }],
])("refuses %s without checking anything", async (_label, body) => {
  expect((await post("/sign-in/email", body)).status).toBe(400);
  expect(h.begin).not.toHaveBeenCalled();
  expect(h.handler).not.toHaveBeenCalled();
});
