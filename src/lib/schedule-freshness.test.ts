import { describe, expect, it } from "vitest";
import {
  MIN_ATTEMPT_GAP_MS,
  STALE_AFTER_MS,
  refreshDue,
} from "./schedule-freshness";

const T0 = 10_000_000;

describe("refreshDue", () => {
  it("leaves data alone until it is old enough", () => {
    const clock = { lastFresh: T0, lastAttempt: T0 };
    expect(refreshDue(clock, T0 + STALE_AFTER_MS - 1)).toBe(false);
    expect(refreshDue(clock, T0 + STALE_AFTER_MS)).toBe(true);
  });

  it("re-reads old data restored in a tab that has never tried", () => {
    expect(
      refreshDue({ lastFresh: T0, lastAttempt: 0 }, T0 + STALE_AFTER_MS),
    ).toBe(true);
  });

  it("waits between attempts when the last one didn't land", () => {
    const at = T0 + STALE_AFTER_MS;
    const clock = { lastFresh: T0, lastAttempt: at };
    expect(refreshDue(clock, at + MIN_ATTEMPT_GAP_MS - 1)).toBe(false);
    expect(refreshDue(clock, at + MIN_ATTEMPT_GAP_MS)).toBe(true);
  });
});
