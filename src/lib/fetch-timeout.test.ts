import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithin } from "./fetch-timeout";

/** A server that never answers, but honors the abort like real fetch. */
function hangingFetch() {
  return vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(init.signal!.reason),
        );
      }),
  );
}

describe("fetchWithin", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects once the deadline passes", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    await expect(fetchWithin(5)("https://x.test")).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });

  it("still honors the caller's own signal", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const caller = new AbortController();
    const pending = fetchWithin(60_000)("https://x.test", {
      signal: caller.signal,
    });
    caller.abort(new Error("caller gave up"));
    await expect(pending).rejects.toThrow("caller gave up");
  });

  it("passes the request through untouched otherwise", async () => {
    const ok = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", ok);
    const res = await fetchWithin(1000)("https://x.test", {
      method: "PATCH",
      cache: "no-store",
    });
    expect(await res.text()).toBe("ok");
    expect(ok).toHaveBeenCalledWith(
      "https://x.test",
      expect.objectContaining({ method: "PATCH", cache: "no-store" }),
    );
  });
});

describe("the Airtable and OpenNode helpers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("give Airtable writes a deadline, with no retry", async () => {
    const fetchMock = vi.fn(async () => new Response('{"id":"rec1"}'));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("AIRTABLE_API_KEY", "key");
    vi.resetModules();
    const { createFormRow } = await import("./airtable-forms");
    await createFormRow("tbl", { a: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = (fetchMock.mock.calls as unknown[][])[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    vi.unstubAllEnvs();
  });

  it("surface a stalled form write once, for the backup path to take over", async () => {
    const hanging = hangingFetch();
    vi.stubGlobal("fetch", hanging);
    vi.stubEnv("AIRTABLE_API_KEY", "key");
    vi.resetModules();
    vi.doMock("@/lib/fetch-timeout", () => ({
      fetchWithin: () => (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(5) }),
    }));
    const { createFormRow } = await import("./airtable-forms");
    await expect(createFormRow("tbl", {})).rejects.toMatchObject({
      name: "TimeoutError",
    });
    expect(hanging).toHaveBeenCalledTimes(1);
    vi.doUnmock("@/lib/fetch-timeout");
    vi.unstubAllEnvs();
  });

  it("give OpenNode calls a deadline", async () => {
    const fetchMock = vi.fn(async () => new Response('{"data":{"id":"c"}}'));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("OPENNODE_KEY", "key");
    vi.resetModules();
    const { getCharge } = await import("./opennode");
    await getCharge("3f2b8c1a-9d4e-4a6b-8c7d-1e2f3a4b5c6d");
    const init = (fetchMock.mock.calls as unknown[][])[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    vi.unstubAllEnvs();
  });
});
