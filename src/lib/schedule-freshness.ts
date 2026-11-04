// When an open /schedule tab re-reads the schedule. Pure, so the policy can be
// tested without a browser; useScheduleFreshness supplies the clock and the
// conditions.

/** Returning to a tab re-reads the schedule once its data is this old. */
export const STALE_AFTER_MS = 10 * 60_000;
/** The least time between attempts, so a flapping tab can't hammer the server. */
export const MIN_ATTEMPT_GAP_MS = 60_000;

export function refreshDue(
  { lastFresh, lastAttempt }: { lastFresh: number; lastAttempt: number },
  now: number,
): boolean {
  return (
    now - lastFresh >= STALE_AFTER_MS && now - lastAttempt >= MIN_ATTEMPT_GAP_MS
  );
}
