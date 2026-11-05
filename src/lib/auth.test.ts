import { expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/env", () => ({ env: { BETTER_AUTH_SECRET: "test-secret" } }));
vi.mock("@/lib/email", () => ({ sendSignInCodeEmail: vi.fn() }));
vi.mock("@/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db")>()),
  getDb: () => ({}),
}));

import { sendSignInCodeEmail } from "@/lib/email";
import { getAuth } from "./auth";

// Codes go out through server actions; /login's holds the budgets.
it.each([
  ["/email-otp/send-verification-otp", { type: "sign-in" }],
  ["/email-otp/request-password-reset", {}],
  ["/forget-password/email-otp", {}],
])("keeps %s off the public API", async (path, extra) => {
  const res = await getAuth().handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", ...extra }),
    }),
  );
  expect(res.status).toBe(404);
  expect(sendSignInCodeEmail).not.toHaveBeenCalled();
});

it("keeps the server-side calls the actions use", () => {
  const { api } = getAuth();
  expect(api.sendVerificationOTP).toBeTypeOf("function");
  expect(api.requestPasswordResetEmailOTP).toBeTypeOf("function");
});
