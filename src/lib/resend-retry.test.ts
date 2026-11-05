import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retryRateLimited } from "./resend-retry";

const ok = { data: { id: "em_1" }, error: null, headers: null };
const limited = (headers: Record<string, string> | null = null) => ({
  data: null,
  error: { name: "rate_limit_exceeded", message: "Too many requests" },
  headers,
});

const elapsed = async (run: Promise<unknown>) => {
  const start = Date.now();
  await vi.runAllTimersAsync();
  await run;
  return Date.now() - start;
};

describe("retryRateLimited", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it("retries a rate-limited send and returns the success", async () => {
    const send = vi.fn().mockResolvedValueOnce(limited()).mockResolvedValue(ok);
    const run = retryRateLimited(send);
    expect(await elapsed(run)).toBe(1000);
    expect(await run).toBe(ok);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("waits as long as Retry-After says, up to the cap", async () => {
    const short = vi
      .fn()
      .mockResolvedValueOnce(limited({ "retry-after": "2" }))
      .mockResolvedValue(ok);
    expect(await elapsed(retryRateLimited(short))).toBe(2000);

    const long = vi
      .fn()
      .mockResolvedValueOnce(limited({ "retry-after": "60" }))
      .mockResolvedValue(ok);
    expect(await elapsed(retryRateLimited(long))).toBe(2000);
  });

  it("gives up after a bounded wait and returns the error", async () => {
    const still = limited({ "retry-after": "60" });
    const send = vi.fn().mockResolvedValue(still);
    const run = retryRateLimited(send);
    expect(await elapsed(run)).toBe(4000);
    expect(await run).toBe(still);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("leaves other errors alone, quota errors included", async () => {
    const quota = {
      data: null,
      error: { name: "monthly_quota_exceeded", message: "Over quota" },
      headers: null,
    };
    const send = vi.fn().mockResolvedValue(quota);
    expect(await retryRateLimited(send)).toBe(quota);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
