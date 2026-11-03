// The only Hat Tricks data that reaches the browser. Hats that are not on
// shift must never appear here, so every field is built from the shift state
// rather than from the whole schedule.

import { formatClockTime, formatShiftTime } from "./hat-tricks-format";
import { HATS, hatById, isHatId, type HatId } from "./hat-tricks-hats";
import { parseSchedule, shiftState } from "./hat-tricks-schedule";
import {
  lastSteals,
  rankTallies,
  scoreHats,
  type LeaderRow,
  type Steal,
} from "./hat-tricks-score";

export type HatCardView = {
  id: HatId;
  name: string;
  art: string;
  photo: string;
  lastStolen: { name: string; atLabel: string } | null;
};

export type StateView =
  | {
      kind: "on";
      hats: HatCardView[];
      endsAt: string;
      endsAtLabel: string;
      nextLine: string | null;
    }
  | { kind: "off"; nextStartsAt: string; nextStartsAtLabel: string }
  | { kind: "done" }
  | { kind: "unposted" };

export type HatTricksView = {
  nowIso: string;
  nowLabel: string;
  state: StateView;
  overall: LeaderRow[];
  perHat: { id: HatId; name: string; rows: LeaderRow[] }[];
};

export function buildHatTricksView(input: {
  rawSchedule: string | undefined;
  steals: readonly Steal[];
  names: ReadonlyMap<string, string>;
  now: Date;
  onScheduleError?: (error: unknown) => void;
}): HatTricksView {
  const { steals, names, now } = input;

  let schedule = parseSchedule(undefined);
  try {
    schedule = parseSchedule(input.rawSchedule);
  } catch (error) {
    input.onScheduleError?.(error);
  }

  const state = shiftState(schedule, now);
  const scores = scoreHats(schedule, steals, now);
  const latest = lastSteals(steals, now);

  const card = (id: HatId): HatCardView => {
    const hat = hatById(id);
    const steal = latest.get(id);
    return {
      id,
      name: hat.name,
      art: hat.art,
      photo: hat.photo ?? hat.art,
      lastStolen: steal
        ? {
            name: names.get(steal.userId) ?? "Unknown",
            atLabel: formatShiftTime(steal.stolenAt),
          }
        : null,
    };
  };

  const visible: HatId[] =
    state.kind === "on"
      ? state.hats
      : state.kind === "done"
        ? HATS.map((hat) => hat.id)
        : [];

  return {
    nowIso: now.toISOString(),
    nowLabel: formatClockTime(now),
    state: buildStateView(state, card),
    overall: rankTallies(scores.overall, names),
    perHat: visible.map((id) => ({
      id,
      name: hatById(id).name,
      rows: rankTallies(scores.byHat[id], names),
    })),
  };
}

function buildStateView(
  state: ReturnType<typeof shiftState>,
  card: (id: HatId) => HatCardView,
): StateView {
  if (state.kind === "on") {
    const endsAtLabel = formatShiftTime(state.endsAt);
    return {
      kind: "on",
      hats: state.hats.map(card),
      endsAt: state.endsAt.toISOString(),
      endsAtLabel,
      nextLine: nextLineFor(state.next, state.endsAt),
    };
  }
  if (state.kind === "off") {
    return {
      kind: "off",
      nextStartsAt: state.nextStartsAt.toISOString(),
      nextStartsAtLabel: formatShiftTime(state.nextStartsAt),
    };
  }
  return { kind: state.kind };
}

function nextLineFor(
  next: { startsAt: Date; endsAt: Date } | null,
  endsAt: Date,
): string | null {
  if (!next) return null;
  if (next.startsAt.getTime() === endsAt.getTime()) {
    return `The shift after that ends at ${formatShiftTime(next.endsAt)}`;
  }
  return `The next shift runs ${formatShiftTime(next.startsAt)} to ${formatShiftTime(next.endsAt)}`;
}

export type PreviewOverrides = {
  rawSchedule: string;
  now?: Date;
  data?: { steals: Steal[]; names: Map<string, string> };
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

function parseStealsParam(raw: string): Steal[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const steals: Steal[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const fields = entry as Record<string, unknown>;
    const stolenAt = parseDate(fields.stolenAt);
    if (!isHatId(fields.hatId) || typeof fields.userId !== "string") continue;
    if (!stolenAt) continue;
    steals.push({ hatId: fields.hatId, userId: fields.userId, stolenAt });
  }
  return steals;
}

function parseNamesParam(raw: string | undefined): Map<string, string> {
  const names = new Map<string, string>();
  if (raw === undefined) return names;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return names;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return names;
  }
  for (const [userId, name] of Object.entries(parsed)) {
    if (typeof name === "string") names.set(userId, name);
  }
  return names;
}

/**
 * Preview-only overrides. A shifted clock is only honoured together with an
 * override schedule, so the event schedule is never shown at a fake time.
 */
export function previewOverrides(
  searchParams: Record<string, string | string[] | undefined>,
  vercelEnv: string | undefined,
): PreviewOverrides | null {
  if (vercelEnv === "production") return null;

  const rawSchedule = first(searchParams.schedule);
  if (rawSchedule === undefined) return null;

  const overrides: PreviewOverrides = { rawSchedule };

  const now = parseDate(first(searchParams.now));
  if (now) overrides.now = now;

  const steals = first(searchParams.steals);
  if (steals !== undefined) {
    overrides.data = {
      steals: parseStealsParam(steals),
      names: parseNamesParam(first(searchParams.names)),
    };
  }

  return overrides;
}
