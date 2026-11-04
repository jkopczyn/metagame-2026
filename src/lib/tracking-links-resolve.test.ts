import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({ env: { AIRTABLE_API_KEY: "test-key" } }));

const record = {
  id: "rec1",
  createdTime: "2026-10-01T00:00:00.000Z",
  fields: { Slug: "puzzle", Destination: "https://metagame.games/" },
};
const answer = (records: unknown[] = [record]) =>
  new Response(JSON.stringify({ records }), { status: 200 });

let fetchMock: ReturnType<typeof vi.fn>;
let resolveTrackingLink: typeof import("./tracking-links").resolveTrackingLink;

beforeEach(async () => {
  vi.useFakeTimers();
  fetchMock = vi.fn(async () => answer());
  vi.stubGlobal("fetch", fetchMock);
  // The cache is module state.
  vi.resetModules();
  ({ resolveTrackingLink } = await import("./tracking-links"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("resolveTrackingLink", () => {
  it("shares one lookup between simultaneous visitors", async () => {
    const links = await Promise.all(
      Array.from({ length: 20 }, () => resolveTrackingLink("puzzle")),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(links.every((l) => l?.slug === "puzzle")).toBe(true);
  });

  it("looks up each slug separately", async () => {
    await Promise.all([resolveTrackingLink("a"), resolveTrackingLink("b")]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("serves an answer for 60s, then looks again", async () => {
    await resolveTrackingLink("puzzle");
    await vi.advanceTimersByTimeAsync(59_999);
    await resolveTrackingLink("puzzle");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await resolveTrackingLink("puzzle");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caches that a slug doesn't exist", async () => {
    fetchMock.mockImplementation(async () => answer([]));
    expect(await resolveTrackingLink("nope")).toBeNull();
    expect(await resolveTrackingLink("nope")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails everyone waiting, caches nothing, and the next visitor retries", async () => {
    fetchMock.mockImplementationOnce(
      async () => new Response("rate limited", { status: 429 }),
    );
    const results = await Promise.allSettled([
      resolveTrackingLink("puzzle"),
      resolveTrackingLink("puzzle"),
    ]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await resolveTrackingLink("puzzle"))?.slug).toBe("puzzle");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up on a stalled lookup, and retries afterwards", async () => {
    vi.useRealTimers();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation(() => AbortSignal.abort(new Error("timed out")));
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_, reject) => {
          if (init.signal?.aborted) reject(init.signal.reason);
          init.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
        }),
    );
    await expect(resolveTrackingLink("puzzle")).rejects.toThrow("timed out");
    expect(timeout).toHaveBeenCalledWith(5_000);
    timeout.mockRestore();
    expect((await resolveTrackingLink("puzzle"))?.slug).toBe("puzzle");
  });
});
