import { describe, expect, it } from "vitest";
import { latestRequest } from "./latest";

describe("latestRequest", () => {
  it("keeps only the newest request current", () => {
    const latest = latestRequest();
    const first = latest.begin();
    expect(first()).toBe(true);
    const second = latest.begin();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it("drops every request in flight on cancel", () => {
    const latest = latestRequest();
    const pending = latest.begin();
    latest.cancel();
    expect(pending()).toBe(false);
  });
});
