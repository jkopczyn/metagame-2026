import { pacificDayKey, pacificMinutes, SLOT_MINUTES } from "@/lib/schedule";

/** A moment on the board: a day index and minutes since Pacific midnight. */
export type Moment = { day: number; t: number };

/** The days the Moments board shows; a `Moment`'s day indexes into these. */
export const boardDays = <D extends { slots: number[] }>(days: D[]): D[] =>
  days.filter((d) => d.slots.length > 0);

/**
 * Where `date` falls on the board, or null when it's on none of its days.
 * Before a day's first slot it waits at the opening, so the board shows what's
 * about to start.
 */
export function momentAt(
  days: { key: string; slots: number[] }[],
  date: Date,
): Moment | null {
  const iso = date.toISOString();
  const shown = boardDays(days);
  const day = shown.findIndex((d) => d.key === pacificDayKey(iso));
  if (day < 0) return null;
  const { slots } = shown[day];
  const end = slots[slots.length - 1] + SLOT_MINUTES;
  return { day, t: Math.min(end - 1, Math.max(slots[0], pacificMinutes(iso))) };
}
