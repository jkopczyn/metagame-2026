// A session's RSVP and bookmark controls live in the modal, which sits outside
// the schedule's tree (over any page, or as /schedule/<slug>'s own page), so a
// context can't reach from one to the other.

export type PlanChange = {
  sessionId: string;
  /** Whether the session now counts as one of the viewer's. */
  mine: boolean;
};

type Listener = (change: PlanChange) => void;

const listeners = new Set<Listener>();

export function onPlanChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** False when no schedule on this page holds the viewer's plans itself. */
export function announcePlanChange(change: PlanChange): boolean {
  listeners.forEach((listener) => listener(change));
  return listeners.size > 0;
}

/** The same rule as viewerSessionIds, for one session. */
export const countsAsMine = (
  plan: { status: string | null; bookmarked: boolean },
  ownSession: boolean,
): boolean => ownSession || plan.status !== null || plan.bookmarked;

export function withPlanChange(
  ids: string[],
  { sessionId, mine }: PlanChange,
): string[] {
  if (ids.includes(sessionId) === mine) return ids;
  return mine ? [...ids, sessionId] : ids.filter((id) => id !== sessionId);
}
