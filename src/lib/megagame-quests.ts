// What a quest holds, as the editor form, the bundle importer and the store
// agree on it. No database or Next imports, so client components can use it.

import {
  MEGAGAME_CLASSES,
  MAX_LEVEL,
  isMegagameClass,
  type MegagameClass,
} from "./megagame-levels";

export const MAX_BODY_IMAGES = 3;
export const MAX_MIN_PLAYERS = 100;
export const MAX_STAMPS = 99;
export const TITLE_MAX = 120;
export const BODY_MAX = 6000;
export const EVIDENCE_MAX = 10000;
export const HINT_MAX = 500;
export const AUTHOR_MAX = 200;

export type StampClass = MegagameClass | "any";
export const STAMP_CLASSES: readonly StampClass[] = [
  ...MEGAGAME_CLASSES,
  "any",
];
export type Stamps = Record<StampClass, number>;
export const NO_STAMPS: Stamps = { wizard: 0, pirate: 0, alien: 0, any: 0 };

/** A quest as written or imported; the code and id are the store's. */
export type QuestInput = {
  title: string;
  bodyText: string;
  /** https URLs, printed in this order. */
  bodyImages: string[];
  class: MegagameClass | null;
  minLevel: number | null;
  maxLevel: number | null;
  minPlayers: number;
  stamps: Stamps;
  evidence: string | null;
  evidenceImage: string | null;
  hint: string | null;
  /** Printed at the foot of the card. */
  author: string | null;
  active: boolean;
};

/** The columns a quest row shares with QuestInput, for reading one back into the form. */
export type QuestFields = Omit<QuestInput, "stamps" | "class"> & {
  /** As stored: text, so an unknown class reads as any class. */
  class: string | null;
  stampsWizard: number;
  stampsPirate: number;
  stampsAlien: number;
  stampsAny: number;
};

export const stampsOf = (q: QuestFields): Stamps => ({
  wizard: q.stampsWizard,
  pirate: q.stampsPirate,
  alien: q.stampsAlien,
  any: q.stampsAny,
});

export const questInputOf = (q: QuestFields): QuestInput => ({
  title: q.title,
  bodyText: q.bodyText,
  bodyImages: q.bodyImages,
  class: q.class !== null && isMegagameClass(q.class) ? q.class : null,
  minLevel: q.minLevel,
  maxLevel: q.maxLevel,
  minPlayers: q.minPlayers,
  stamps: stampsOf(q),
  evidence: q.evidence,
  evidenceImage: q.evidenceImage,
  hint: q.hint,
  author: q.author,
  active: q.active,
});

/** The stamps a quest awards, in class order, zeros left out. */
export const stampList = (stamps: Stamps): { class: StampClass; n: number }[] =>
  STAMP_CLASSES.filter((c) => stamps[c] > 0).map((c) => ({
    class: c,
    n: stamps[c],
  }));

/** Which art the printed card uses: the quest's class, or the star for any class. */
export const cardBackground = (q: {
  class: string | null;
}): MegagameClass | "star" =>
  q.class !== null && isMegagameClass(q.class) ? q.class : "star";

export type ParsedQuest =
  | { ok: true; input: QuestInput }
  | { ok: false; errors: string[] };

const isHttpsUrl = (v: unknown): v is string =>
  typeof v === "string" && /^https:\/\/\S+$/.test(v);

const text = (v: unknown): string =>
  (typeof v === "string" ? v : v == null ? "" : String(v))
    .replace(/\r\n/g, "\n")
    .trim();

const whole = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isInteger(v) ? v : null;
  if (typeof v === "string" && /^\s*\d+\s*$/.test(v)) return Number(v);
  return null;
};

/**
 * Checks a quest as the form or a bundle entry describes it: strings and
 * numbers (or numeric strings), class names in any case. Every problem is
 * reported, not just the first.
 */
export function parseQuestInput(raw: Record<string, unknown>): ParsedQuest {
  const errors: string[] = [];
  const title = text(raw.title);
  if (!title) errors.push("title: required");
  else if (title.length > TITLE_MAX)
    errors.push(`title: at most ${TITLE_MAX} characters`);

  const bodyText = text(raw.bodyText);
  if (bodyText.length > BODY_MAX)
    errors.push(`bodyText: at most ${BODY_MAX} characters`);

  const images = Array.isArray(raw.bodyImages) ? raw.bodyImages : [];
  if (!Array.isArray(raw.bodyImages) && raw.bodyImages != null)
    errors.push("bodyImages: must be a list");
  if (images.length > MAX_BODY_IMAGES)
    errors.push(`bodyImages: at most ${MAX_BODY_IMAGES} images`);
  if (!images.every(isHttpsUrl)) errors.push("bodyImages: not an https URL");

  const classRaw = text(raw.class).toLowerCase();
  const cls = classRaw === "" || classRaw === "any" ? null : classRaw;
  if (cls !== null && !isMegagameClass(cls))
    errors.push(`class: unknown class "${classRaw}"`);

  const level = (key: "minLevel" | "maxLevel"): number | null => {
    const v = raw[key];
    if (v == null || v === "") return null;
    const n = whole(v);
    if (n === null || n < 1 || n > MAX_LEVEL) {
      errors.push(`${key}: a level from 1 to ${MAX_LEVEL}`);
      return null;
    }
    return n;
  };
  const minLevel = level("minLevel");
  const maxLevel = level("maxLevel");
  if (cls === null && (minLevel !== null || maxLevel !== null))
    errors.push("minLevel/maxLevel: a level window needs a class");
  if (minLevel !== null && maxLevel !== null && minLevel > maxLevel)
    errors.push("minLevel/maxLevel: the minimum is above the maximum");

  let minPlayers = 1;
  if (raw.minPlayers != null && raw.minPlayers !== "") {
    const n = whole(raw.minPlayers);
    if (n === null || n < 1 || n > MAX_MIN_PLAYERS)
      errors.push(`minPlayers: a number from 1 to ${MAX_MIN_PLAYERS}`);
    else minPlayers = n;
  }

  const stamps = { ...NO_STAMPS };
  const stampsRaw =
    raw.stamps && typeof raw.stamps === "object"
      ? (raw.stamps as Record<string, unknown>)
      : {};
  if (raw.stamps != null && typeof raw.stamps !== "object")
    errors.push("stamps: must be an object of class to count");
  for (const [key, v] of Object.entries(stampsRaw)) {
    const c = key.toLowerCase();
    if (!STAMP_CLASSES.includes(c as StampClass)) {
      errors.push(`stamps: unknown class "${key}"`);
      continue;
    }
    if (v == null || v === "") continue;
    const n = whole(v);
    if (n === null || n < 0 || n > MAX_STAMPS)
      errors.push(`stamps.${c}: a number from 0 to ${MAX_STAMPS}`);
    else stamps[c as StampClass] = n;
  }

  const evidence = text(raw.evidence);
  if (evidence.length > EVIDENCE_MAX)
    errors.push(`evidence: at most ${EVIDENCE_MAX} characters`);
  const evidenceImage =
    raw.evidenceImage == null || raw.evidenceImage === ""
      ? null
      : isHttpsUrl(raw.evidenceImage)
        ? raw.evidenceImage
        : (errors.push("evidenceImage: not an https URL"), null);

  const hint = text(raw.hint);
  if (hint.length > HINT_MAX)
    errors.push(`hint: at most ${HINT_MAX} characters`);

  const author = text(raw.author);
  if (author.length > AUTHOR_MAX)
    errors.push(`author: at most ${AUTHOR_MAX} characters`);

  const active =
    raw.active == null || raw.active === ""
      ? true
      : raw.active === true || raw.active === "true" || raw.active === "on";

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      title,
      bodyText,
      bodyImages: images as string[],
      class: cls as MegagameClass | null,
      minLevel,
      maxLevel,
      minPlayers,
      stamps,
      evidence: evidence || null,
      evidenceImage,
      hint: hint || null,
      author: author || null,
      active,
    },
  };
}
