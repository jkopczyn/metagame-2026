import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  counts: new Map<string, number>(),
  writes: 0,
  fail: null as null | (() => Promise<never>),
}));

vi.mock("@/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db")>()),
  getDb: () => ({
    insert: () => ({
      values: ({ id }: { id: string }) => ({
        onConflictDoUpdate: () => ({
          returning: async () => {
            store.writes++;
            if (store.fail) return store.fail();
            const value = (store.counts.get(id) ?? 0) + 1;
            store.counts.set(id, value);
            return [{ value: String(value) }];
          },
        }),
      }),
    }),
  }),
}));

import { clientIp, overBudget, throttled } from "./throttle";

const from = (ip: string) =>
  new Request("https://x.test/", { headers: { "x-forwarded-for": ip } });

beforeEach(() => {
  store.counts.clear();
  store.writes = 0;
  store.fail = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("throttled", () => {
  it("allows the whole budget, then answers 429 with when to retry", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-06T10:15:00Z") });
    for (let i = 0; i < 1000; i++) {
      expect(await throttled(from("1.1.1.1"), "contact")).toBeNull();
    }
    const res = await throttled(from("1.1.1.1"), "contact");
    expect(res?.status).toBe(429);
    expect(res?.headers.get("Retry-After")).toBe(String(45 * 60));
    expect((await res?.json()).error).toMatch(/try again/i);
  });

  it("keeps addresses and budgets apart", async () => {
    for (let i = 0; i < 1001; i++) await throttled(from("1.1.1.2"), "contact");
    expect(await throttled(from("1.1.1.2"), "contact")).not.toBeNull();
    expect(await throttled(from("1.1.1.3"), "contact")).toBeNull();
    expect(await throttled(from("1.1.1.2"), "signup")).toBeNull();
  });

  it("starts over in the next window", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-06T10:00:00Z") });
    for (let i = 0; i < 1000; i++) await throttled(from("1.1.1.4"), "contact");
    expect(await throttled(from("1.1.1.4"), "contact")).not.toBeNull();
    vi.setSystemTime(new Date("2026-11-06T11:00:00Z"));
    expect(await throttled(from("1.1.1.4"), "contact")).toBeNull();
  });

  it("stops writing to the database once a window is spent", async () => {
    for (let i = 0; i < 1001; i++) await throttled(from("1.1.1.5"), "contact");
    const writes = store.writes;
    expect(await throttled(from("1.1.1.5"), "contact")).not.toBeNull();
    expect(store.writes).toBe(writes);
  });

  it("shares a global budget across addresses", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-06T10:30:00Z") });
    expect(await throttled(from("2.2.2.1"), "egg")).toBeNull();
    expect(await throttled(from("2.2.2.2"), "egg")).toBeNull();
    expect(await throttled(from("3.3.3.3"), "egg")).not.toBeNull();
    vi.setSystemTime(new Date("2026-11-06T10:30:01Z"));
    expect(await throttled(from("3.3.3.3"), "egg")).toBeNull();
  });

  // Airtable allows 5 a second to the whole base, and purchases need one of them.
  it("lets at most 4 eggs through in any second, across a window edge", async () => {
    const cast = () => throttled(from("4.4.4.4"), "egg");
    let through = 0;
    for (const at of ["10:40:00.999Z", "10:40:01.000Z"]) {
      vi.useFakeTimers({ now: new Date(`2026-11-06T${at}`) });
      for (let i = 0; i < 10; i++) if (!(await cast())) through++;
    }
    expect(through).toBe(4);
  });

  it("doesn't touch the store without an address to charge", async () => {
    const res = await throttled(new Request("https://x.test/"), "contact");
    expect(res).toBeNull();
    expect(store.writes).toBe(0);
  });

  it("fails open when the store errors", async () => {
    store.fail = () => Promise.reject(new Error("neon down"));
    expect(await throttled(from("1.1.1.6"), "contact")).toBeNull();
  });

  it("fails open when the store hangs", async () => {
    vi.useFakeTimers();
    store.fail = () => new Promise<never>(() => {});
    const pending = overBudget("contact", from("1.1.1.7").headers);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await pending).toBe(false);
  });
});

describe("clientIp", () => {
  it.each([
    ["203.0.113.9", "203.0.113.9"],
    ["203.0.113.9, 10.0.0.1", "203.0.113.9"],
    ["::ffff:203.0.113.9", "203.0.113.9"],
    ["2001:db8:1:2:3:4:5:6", "2001:db8:1:2"],
    ["2001:db8:1:2:ffff::1", "2001:db8:1:2"],
    ["2001:0DB8::1", "2001:db8:0:0"],
    ["1:2::3:4:5:6:7", "1:2:0:3"],
    ["::1", "0:0:0:0"],
  ])("%s is charged as %s", (header, expected) => {
    expect(clientIp(new Headers({ "x-forwarded-for": header }))).toBe(expected);
  });

  it("is null without the header", () => {
    expect(clientIp(new Headers())).toBeNull();
  });
});
