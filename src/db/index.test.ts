import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: { DATABASE_URL: "postgres://u:p@ep-test.neon.tech/db" },
}));

import { getDb } from "./index";

describe("getDb", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("gives every query its own deadline", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            command: "SELECT",
            rowCount: 0,
            rowAsArray: true,
            fields: [],
            rows: [],
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await getDb().execute(sql`select 1`);
    await getDb().execute(sql`select 1`);
    const signals = (fetchMock.mock.calls as unknown[][]).map(
      ([, init]) => (init as RequestInit).signal,
    );
    expect(signals).toHaveLength(2);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[1]).not.toBe(signals[0]);
  });
});
