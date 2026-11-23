import { describe, expect, it, vi } from "vitest";
import {
  isNetworkError,
  keepingSavedAt,
  OFFLINE_MESSAGE,
  retryable,
} from "./action-retry";

type State = {
  step?: string;
  email?: string;
  error?: string;
  saved?: boolean;
  field?: string;
  savedAt?: number;
};

describe("isNetworkError", () => {
  it.each([
    "Failed to fetch",
    "NetworkError when attempting to fetch resource.",
    "Load failed",
    "The network connection was lost.",
    "The Internet connection appears to be offline.",
  ])("recognizes %s", (message) => {
    expect(isNetworkError(new TypeError(message))).toBe(true);
  });

  it("doesn't take other errors for one", () => {
    expect(isNetworkError(new TypeError("x is not a function"))).toBe(false);
    expect(isNetworkError(new Error("Failed to fetch"))).toBe(false);
    expect(isNetworkError("Failed to fetch")).toBe(false);
  });
});

describe("retryable", () => {
  const offline = async (): Promise<State> => {
    throw new TypeError("Failed to fetch");
  };

  it("passes a normal result through", async () => {
    const result: State = { step: "code" };
    await expect(retryable(async () => result)({}, null)).resolves.toBe(result);
  });

  it("stays on the same step with a retry message", async () => {
    const prev: State = { step: "password", email: "a@b.co" };
    await expect(retryable(offline)(prev, null)).resolves.toMatchObject({
      step: "password",
      email: "a@b.co",
      error: OFFLINE_MESSAGE,
    });
  });

  it("drops flags from the last submit but keeps what identifies the form", async () => {
    const prev: State = { saved: true, field: "title", savedAt: 5 };
    const next = await retryable(offline)(prev, null);
    expect(next.saved).toBeUndefined();
    expect(next.field).toBeUndefined();
    expect(next.savedAt).toBe(5);
  });

  it("restores what was typed", async () => {
    const next = await retryable(offline, (typed: string) => ({
      email: typed,
    }))({ step: "email", email: "" }, "a@b.co");
    expect(next.email).toBe("a@b.co");
  });

  it("rethrows a redirect so Next can act on it", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;push;/account;303;",
    });
    const action = vi.fn(async (): Promise<State> => {
      throw redirect;
    });
    await expect(retryable(action)({}, null)).rejects.toBe(redirect);
  });

  it("rethrows a server failure for the error boundary", async () => {
    const failing = async (): Promise<State> => {
      throw new Error("An error occurred in the Server Components render.");
    };
    await expect(retryable(failing)({}, null)).rejects.toThrow("Server");
  });
});

describe("keepingSavedAt", () => {
  it("keeps the last save behind an error", async () => {
    const failed = keepingSavedAt(
      async (): Promise<State> => ({ error: "Your session expired." }),
    );
    await expect(failed({ savedAt: 5 }, null)).resolves.toEqual({
      error: "Your session expired.",
      savedAt: 5,
    });
  });

  it("takes the new save and drops the old error", async () => {
    const saved = keepingSavedAt(async (): Promise<State> => ({ savedAt: 9 }));
    const next = await saved({ savedAt: 5, error: "Nope." }, null);
    expect(next).toEqual({ savedAt: 9 });
  });
});
