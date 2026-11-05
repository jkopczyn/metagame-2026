import { beforeEach, expect, it, vi } from "vitest";

const { sendOtp, spent } = vi.hoisted(() => ({
  sendOtp: vi.fn(),
  spent: new Set<string>(),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "198.51.100.1" }),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  codeDelivered: async (send: () => Promise<unknown>) => {
    await send();
    return true;
  },
  currentSession: vi.fn(),
  getAuth: () => ({ api: { sendVerificationOTP: sendOtp } }),
  hasPassword: vi.fn(),
  replacePassword: vi.fn(),
}));
vi.mock("@/lib/throttle", () => ({
  overBudget: vi.fn(async (name: string) => spent.has(name)),
}));

import { overBudget } from "@/lib/throttle";
import { authenticate } from "./actions";

const requestCode = () => {
  const form = new FormData();
  form.set("intent", "code");
  form.set("email", "ada@example.com");
  return authenticate({ step: "email", email: "" }, form);
};

beforeEach(() => {
  vi.clearAllMocks();
  spent.clear();
});

it("sends the code while both budgets have room", async () => {
  const state = await requestCode();
  expect(state.step).toBe("code");
  expect(sendOtp).toHaveBeenCalledOnce();
});

it("refuses past the per-IP budget without spending the shared ceiling", async () => {
  spent.add("signInCode");
  const state = await requestCode();
  expect(state).toMatchObject({ step: "email", error: /too many/i });
  expect(sendOtp).not.toHaveBeenCalled();
  expect(overBudget).not.toHaveBeenCalledWith("signInCodeTotal");
});

it("refuses past the global ceiling", async () => {
  spent.add("signInCodeTotal");
  const state = await requestCode();
  expect(state).toMatchObject({ step: "email", error: /too many/i });
  expect(sendOtp).not.toHaveBeenCalled();
});
