const MAX_RETRIES = 2;
const DEFAULT_WAIT_MS = 1_000;
const MAX_WAIT_MS = 2_000;

/**
 * Resend's rate limit is per team, and the SDK hands a 429 back as an `error`
 * without retrying. A limited request wasn't processed, so sending it again
 * can't duplicate anything.
 */
export async function retryRateLimited<
  T extends {
    error: { name: string } | null;
    headers?: Record<string, string> | null;
  },
>(send: () => Promise<T>): Promise<T> {
  for (let retry = 0; ; retry++) {
    const result = await send();
    if (result.error?.name !== "rate_limit_exceeded" || retry === MAX_RETRIES)
      return result;
    const seconds = Number(result.headers?.["retry-after"]);
    const wait = seconds > 0 ? seconds * 1000 : DEFAULT_WAIT_MS;
    await new Promise((r) => setTimeout(r, Math.min(wait, MAX_WAIT_MS)));
  }
}
