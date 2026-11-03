// Parsing and querying of the Hat Tricks shift schedule. The schedule itself
// is never in the repository; it arrives as JSON in HAT_TRICKS_SCHEDULE.

import { isHatId, type HatId } from "./hat-tricks-hats";

export type Shift = { start: Date; end: Date; hats: HatId[] };
export type Schedule = readonly Shift[];

export class ScheduleParseError extends Error {}

const TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):(\d{2}))$/;

function parseInstant(value: unknown, field: string, prefix: string): Date {
  if (typeof value !== "string") {
    throw new ScheduleParseError(`${prefix}${field} must be a string`);
  }
  const match = TIMESTAMP.exec(value);
  if (!match) {
    throw new ScheduleParseError(
      `${prefix}${field} must be an ISO timestamp with an offset: ${value}`,
    );
  }
  const [, year, month, day, hour, minute, second, fraction, zone, sign] =
    match;
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  const h = Number(hour);
  const mi = Number(minute);
  const s = second ? Number(second) : 0;
  const ms = fraction ? Number(fraction.padEnd(3, "0")) : 0;

  // Date.UTC rolls invalid components over, so compare them back instead of
  // trusting new Date(string).
  const wall = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  const check = new Date(wall);
  const sameWallTime =
    check.getUTCFullYear() === y &&
    check.getUTCMonth() === mo - 1 &&
    check.getUTCDate() === d &&
    check.getUTCHours() === h &&
    check.getUTCMinutes() === mi &&
    check.getUTCSeconds() === s;
  if (!sameWallTime) {
    throw new ScheduleParseError(
      `${prefix}${field} is not a valid date and time: ${value}`,
    );
  }

  let offsetMs = 0;
  if (zone !== "Z") {
    const offsetHours = Number(match[10]);
    const offsetMinutes = Number(match[11]);
    if (offsetHours > 14 || offsetMinutes > 59) {
      throw new ScheduleParseError(
        `${prefix}${field} has an out-of-range offset: ${value}`,
      );
    }
    offsetMs =
      (sign === "-" ? -1 : 1) * (offsetHours * 60 + offsetMinutes) * 60_000;
  }

  return new Date(wall - offsetMs);
}

function parseHats(value: unknown, prefix: string): HatId[] {
  if (!Array.isArray(value)) {
    throw new ScheduleParseError(`${prefix}hats must be an array`);
  }
  if (value.length === 0) {
    throw new ScheduleParseError(`${prefix}hats must not be empty`);
  }
  if (value.length > 2) {
    throw new ScheduleParseError(`${prefix}hats must hold at most two ids`);
  }
  const hats: HatId[] = [];
  for (const entry of value) {
    if (!isHatId(entry)) {
      throw new ScheduleParseError(
        `${prefix}unknown hat id: ${JSON.stringify(entry)}`,
      );
    }
    if (hats.includes(entry)) {
      throw new ScheduleParseError(`${prefix}duplicate hat id: ${entry}`);
    }
    hats.push(entry);
  }
  return hats;
}

/** undefined, "" or whitespace -> []. Anything invalid throws ScheduleParseError. */
export function parseSchedule(raw: string | undefined): Schedule {
  if (raw === undefined || raw.trim() === "") return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ScheduleParseError(
      `not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new ScheduleParseError("must be a JSON array of shifts");
  }

  const shifts: Shift[] = [];
  parsed.forEach((entry, index) => {
    const prefix = `shift ${index + 1}: `;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new ScheduleParseError(`${prefix}must be an object`);
    }
    const fields = entry as Record<string, unknown>;
    const start = parseInstant(fields.start, "start", prefix);
    const end = parseInstant(fields.end, "end", prefix);
    if (end.getTime() <= start.getTime()) {
      throw new ScheduleParseError(`${prefix}end must be after start`);
    }
    const hats = parseHats(fields.hats, prefix);
    const previous = shifts[shifts.length - 1];
    if (previous && previous.end.getTime() > start.getTime()) {
      throw new ScheduleParseError(
        `${prefix}starts before the previous shift ends`,
      );
    }
    shifts.push({ start, end, hats });
  });
  return shifts;
}

/** The shift with start <= now < end, or null. */
export function currentShift(schedule: Schedule, now: Date): Shift | null {
  const at = now.getTime();
  return (
    schedule.find((s) => s.start.getTime() <= at && at < s.end.getTime()) ??
    null
  );
}

/** The first shift with start >= now, or null. */
export function nextShift(schedule: Schedule, now: Date): Shift | null {
  const at = now.getTime();
  return schedule.find((s) => s.start.getTime() >= at) ?? null;
}

export type ShiftState =
  | {
      kind: "on";
      hats: HatId[];
      endsAt: Date;
      next: { startsAt: Date; endsAt: Date } | null;
    }
  | { kind: "off"; nextStartsAt: Date }
  | { kind: "done" }
  | { kind: "unposted" };

export function shiftState(schedule: Schedule, now: Date): ShiftState {
  if (schedule.length === 0) return { kind: "unposted" };

  const at = now.getTime();
  const index = schedule.findIndex(
    (s) => s.start.getTime() <= at && at < s.end.getTime(),
  );
  if (index >= 0) {
    const current = schedule[index];
    const following = schedule[index + 1];
    return {
      kind: "on",
      hats: current.hats,
      endsAt: current.end,
      next: following
        ? { startsAt: following.start, endsAt: following.end }
        : null,
    };
  }

  const upcoming = nextShift(schedule, now);
  if (upcoming) return { kind: "off", nextStartsAt: upcoming.start };
  return { kind: "done" };
}

export type Bounds = { from: "open" | "closed"; to: "open" | "closed" };

const DEFAULT_BOUNDS: Bounds = { from: "open", to: "closed" };

/**
 * Distinct shift start/end instants between from and to, ascending.
 * Default bounds are { from: "open", to: "closed" }, i.e. (from, to].
 */
export function shiftChangesBetween(
  schedule: Schedule,
  from: Date,
  to: Date,
  bounds: Bounds = DEFAULT_BOUNDS,
): Date[] {
  const lower = from.getTime();
  const upper = to.getTime();
  if (lower > upper) return [];

  const instants = new Set<number>();
  for (const s of schedule) {
    instants.add(s.start.getTime());
    instants.add(s.end.getTime());
  }

  return [...instants]
    .sort((a, b) => a - b)
    .filter(
      (t) =>
        (bounds.from === "closed" ? t >= lower : t > lower) &&
        (bounds.to === "closed" ? t <= upper : t < upper),
    )
    .map((t) => new Date(t));
}
