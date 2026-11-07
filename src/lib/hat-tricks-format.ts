import { PACIFIC } from "@/lib/schedule";

const SHIFT_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC,
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const CLOCK_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC,
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
});

// ICU versions differ on the comma after the weekday and on which space goes
// before AM/PM, so normalise both.
function normalize(label: string): string {
  return label.replace(",", "").replace(/[  ]/g, " ");
}

function toDate(at: Date | string): Date {
  return typeof at === "string" ? new Date(at) : at;
}

/** "Sat 3:45 PM" in Pacific. */
export function formatShiftTime(at: Date | string): string {
  return normalize(SHIFT_TIME.format(toDate(at)));
}

/** "Sat 3:45:07 PM" in Pacific, for the ticking clock. */
export function formatClockTime(at: Date | string): string {
  return normalize(CLOCK_TIME.format(toDate(at)));
}
