// OpenNode charge lifecycle, narrowed to what we surface here.
export type Phase =
  | "loading"
  | "pending"
  | "paid"
  | "underpaid"
  | "expired"
  | "refunded"
  | "error";

export function phaseFor(status: string): Phase {
  switch (status) {
    case "paid":
      return "paid";
    case "underpaid":
      return "underpaid";
    case "expired":
      return "expired";
    case "refunded":
      return "refunded";
    default:
      // processing / unpaid / anything else → still waiting.
      return "pending";
  }
}

/**
 * The phase after a poll, where null means the poll failed. A failure only
 * shows while we've never had an answer: a dropped connection doesn't change
 * what we last heard about the payment.
 */
export function nextPhase(current: Phase, status: string | null): Phase {
  if (status != null) return phaseFor(status);
  return current === "loading" ? "error" : current;
}

/** Nothing further to hear; underpaid and expired can still move on. */
export function isFinal(phase: Phase): boolean {
  return phase === "paid" || phase === "refunded";
}
