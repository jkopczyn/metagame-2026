// Pure megagame rules: code and answer matching, soft checks, and the
// over-time chart's bucket math. No database or Next imports, so client
// components can use it. Class list and level maximum come from
// megagame-levels.ts.

import {
  MAX_LEVEL,
  isMegagameClass,
  type MegagameClass,
  type MegagameLevels,
} from "./megagame-levels";
import { TICKET_CODE_LENGTH, normalizeTicketCode } from "./ticket-code-format";

/** A quest code as typed, scanned, or pasted as a /q/<code> URL. */
export function normalizeMegagameCode(input: string): string {
  let text = input.trim();
  const cut = text.search(/[?#]/);
  if (cut !== -1) text = text.slice(0, cut);
  text = text.replace(/\/+$/, "");
  if (text.includes("/")) text = text.slice(text.lastIndexOf("/") + 1);
  return normalizeTicketCode(text);
}

/** Whether a normalized code is a full code, which is what a lookup needs. */
export function isCompleteMegagameCode(code: string): boolean {
  return code.length === TICKET_CODE_LENGTH;
}

/** A typed badge number: one to four digits, leading zeros allowed. */
export function normalizeBadgeNumber(input: string): number | null {
  const digits = input.replace(/\s+/g, "");
  return /^\d{1,4}$/.test(digits) ? Number(digits) : null;
}

export type ScannedCode =
  | { kind: "quest"; code: string }
  | { kind: "player"; badgeNumber: number };

/**
 * A QR payload: a badge's bare four-digit number, a quest label's /q/<code>
 * URL on any host, or a bare six-character quest code.
 */
export function parseScannedCode(text: string): ScannedCode | null {
  const raw = text.trim();
  if (/^\d{4}$/.test(raw)) return { kind: "player", badgeNumber: Number(raw) };
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw) || raw.startsWith("/")) {
    let path: string;
    try {
      path = new URL(raw, "https://x.invalid").pathname;
    } catch {
      return null;
    }
    const parts = path.split("/").filter(Boolean);
    if (parts.at(-2) !== "q") return null;
    const code = normalizeTicketCode(parts.at(-1)!);
    return isCompleteMegagameCode(code) ? { kind: "quest", code } : null;
  }
  if (!/^[\dA-Za-z\s-]+$/.test(raw)) return null;
  const code = normalizeTicketCode(raw);
  return isCompleteMegagameCode(code) ? { kind: "quest", code } : null;
}

/** Case, accents, punctuation and whitespace do not matter. */
export function normalizeAnswer(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export type AnswerMatch = { matched: boolean; answer: string | null };

/** `answer` is the accepted answer as stored, for showing the volunteer what matched. */
export function matchAnswer(
  entered: string,
  accepted: readonly string[],
): AnswerMatch {
  const wanted = normalizeAnswer(entered);
  if (wanted === "") return { matched: false, answer: null };
  for (const candidate of accepted) {
    if (normalizeAnswer(candidate) === wanted) {
      return { matched: true, answer: candidate };
    }
  }
  return { matched: false, answer: null };
}

export type LevelUpInput = {
  class: MegagameClass;
  /** The level being awarded. */
  level: number;
  /** The player's current levels, from the profile's level columns. */
  levels: MegagameLevels;
  /** Completed quests this player has in that class; shown, not checked. */
  completionsInClass: number;
};

export type LevelUpCheck = {
  /** False means refuse: these are not overridable. */
  ok: boolean;
  errors: string[];
  /** Overridable with "Yes, I'm sure" plus an optional reason. */
  warnings: string[];
};

/** "1, 2 and 3" */
function listLevels(levels: number[]): string {
  if (levels.length === 1) return String(levels[0]);
  return `${levels.slice(0, -1).join(", ")} and ${levels.at(-1)}`;
}

/** "Skips level 2." / "Skips levels 1, 2 and 3." Levels above MAX_LEVEL never get here. */
function skipWarning(from: number, to: number): string {
  if (from === to) return `Skips level ${from}.`;
  const skipped: number[] = [];
  for (let n = from; n <= to; n += 1) skipped.push(n);
  return `Skips levels ${listLevels(skipped)}.`;
}

export function checkLevelUp(input: LevelUpInput): LevelUpCheck {
  const { class: cls, level, levels } = input;
  const current = levels[cls] ?? 0;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!Number.isInteger(level) || level < 1) {
    errors.push("A level must be a whole number of 1 or more.");
  } else if (level > MAX_LEVEL) {
    // Matches the check constraints on the profile's level columns.
    errors.push(`Level ${level} is above the maximum of ${MAX_LEVEL}.`);
  } else if (level <= current) {
    errors.push(
      `Already a level ${current} ${cls}; a new level must be higher.`,
    );
  }

  if (errors.length === 0 && level > current + 1) {
    warnings.push(skipWarning(current + 1, level - 1));
  }

  return { ok: errors.length === 0, errors, warnings };
}

export type QuestWindow = {
  /** Null or absent means any class. */
  class?: string | null;
  minLevel?: number | null;
  maxLevel?: number | null;
};

export type QuestWindowCheck = {
  /** False means show the warning; nothing here blocks a confirmation. */
  ok: boolean;
  warnings: string[];
};

export function checkQuestWindow(
  quest: QuestWindow,
  levels: MegagameLevels,
): QuestWindowCheck {
  const warnings: string[] = [];
  if (quest.class == null) return { ok: true, warnings };
  if (!isMegagameClass(quest.class)) {
    warnings.push(`Quest class "${quest.class}" is not a known class.`);
    return { ok: false, warnings };
  }
  const cls = quest.class;
  const level = levels[cls] ?? 0;
  if (level === 0) {
    warnings.push(`Not a ${cls} yet.`);
  } else if (quest.minLevel != null && level < quest.minLevel) {
    warnings.push(
      `Level ${level} ${cls}; this quest asks for level ${quest.minLevel} or higher.`,
    );
  } else if (quest.maxLevel != null && level > quest.maxLevel) {
    warnings.push(
      `Level ${level} ${cls}; this quest is for level ${quest.maxLevel} and below.`,
    );
  }
  return { ok: warnings.length === 0, warnings };
}

/**
 * One player's row on a quest page. A live completion is the only hard
 * block; the lock window and a missing ticket only warn.
 */
export type PlayerQuestStatus =
  | { kind: "completed" }
  | { kind: "ok"; warnings: string[] };

export function playerQuestStatus(input: {
  quest: QuestWindow;
  levels: MegagameLevels;
  completed: boolean;
  hasTicket: boolean;
}): PlayerQuestStatus {
  if (input.completed) return { kind: "completed" };
  const warnings = checkQuestWindow(input.quest, input.levels).warnings;
  if (!input.hasTicket) warnings.push("No claimed ticket.");
  return { kind: "ok", warnings };
}

/** A level window needs a class. */
export function questWindowIsValid(quest: QuestWindow): boolean {
  return (
    quest.class != null || (quest.minLevel == null && quest.maxLevel == null)
  );
}

export const BUCKET_SIZES = [
  "5m",
  "15m",
  "30m",
  "1h",
  "3h",
  "6h",
  "1d",
] as const;
export type BucketSize = (typeof BUCKET_SIZES)[number];

export const isBucketSize = (value: unknown): value is BucketSize =>
  BUCKET_SIZES.includes(value as BucketSize);

/** Minutes per bucket, used for the JavaScript side of the math. */
export const BUCKET_MINUTES: Record<BucketSize, number> = {
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "3h": 180,
  "6h": 360,
  "1d": 1440,
};

// The only place a Postgres interval literal for date_bin comes from: a fixed
// map, never a caller's string.
const BUCKET_INTERVALS: Record<BucketSize, string> = {
  "5m": "5 minutes",
  "15m": "15 minutes",
  "30m": "30 minutes",
  "1h": "1 hour",
  "3h": "3 hours",
  "6h": "6 hours",
  "1d": "1 day",
};

/** Throws on anything not in BUCKET_SIZES, so no input reaches SQL unchecked. */
export function bucketIntervalSql(size: string): string {
  if (!isBucketSize(size)) throw new Error(`Unknown bucket size: ${size}`);
  return BUCKET_INTERVALS[size];
}

// Shared origin for date_bin, so the JavaScript buckets and the SQL buckets
// line up. Con days are Pacific, so this is midnight Pacific standard time
// (UTC-8). Every size divides a day evenly, so only the origin's time of day
// matters.
export const BUCKET_ORIGIN = new Date(Date.UTC(2026, 0, 1, 8));

export function bucketStart(at: Date, size: BucketSize): Date {
  const ms = BUCKET_MINUTES[size] * 60_000;
  const origin = BUCKET_ORIGIN.getTime();
  return new Date(Math.floor((at.getTime() - origin) / ms) * ms + origin);
}

/** Every bucket start from `from`'s bucket to `to`'s bucket, inclusive. */
export function bucketSeries(from: Date, to: Date, size: BucketSize): Date[] {
  if (to.getTime() < from.getTime()) return [];
  const ms = BUCKET_MINUTES[size] * 60_000;
  const last = bucketStart(to, size).getTime();
  const out: Date[] = [];
  for (let t = bucketStart(from, size).getTime(); t <= last; t += ms) {
    out.push(new Date(t));
  }
  return out;
}
