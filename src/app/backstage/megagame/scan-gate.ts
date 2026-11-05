/**
 * The camera reads a code held in view on every frame. A payload passes once,
 * and again only after it has been out of view for `windowMs`.
 */
export function repeatGate(windowMs: number) {
  const lastSeen = new Map<string, number>();
  return {
    accept(payload: string, now: number): boolean {
      const seen = lastSeen.get(payload);
      lastSeen.set(payload, now);
      return seen === undefined || now - seen > windowMs;
    },
    reset() {
      lastSeen.clear();
    },
  };
}
