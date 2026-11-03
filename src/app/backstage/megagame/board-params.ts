import { parsePlayerIds } from "./player-list";
import { isUuid } from "./uuid";
import { normalizeMegagameCode } from "@/lib/megagame-rules";

// Everything the Quest Board shows is chosen by its query parameters, so a
// reload, a tab switch or a camera detour keeps it.

export const BOARD = "/backstage/megagame";
export const RECENT_STEP = 30;
export const RECENT_MAX = 300;

export type BoardParams = {
  /** Normalized, possibly incomplete, so the page can say it was not found. */
  quest: string | null;
  players: string[];
  confirmation: string | null;
  levelUp: string | null;
  recent: number;
  range: string | null;
  bucket: string | null;
};

export type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) =>
  ([v].flat()[0] ?? "").trim();

function parseRecent(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= RECENT_STEP) return RECENT_STEP;
  return Math.min(RECENT_MAX, Math.ceil(n / RECENT_STEP) * RECENT_STEP);
}

export function parseBoardParams(sp: SearchParams): BoardParams {
  const quest = normalizeMegagameCode(first(sp.quest)).slice(0, 12);
  const c = first(sp.c);
  return {
    quest: quest || null,
    players: parsePlayerIds(sp.players),
    confirmation: isUuid(c) ? c : null,
    levelUp: first(sp.levelup).slice(0, 100) || null,
    recent: parseRecent(first(sp.recent)),
    range: first(sp.range) || null,
    bucket: first(sp.bucket) || null,
  };
}

export function boardHref(p: Partial<BoardParams>): string {
  const params = new URLSearchParams();
  if (p.quest) params.set("quest", p.quest);
  if (p.players && p.players.length > 0)
    params.set("players", p.players.join(","));
  if (p.confirmation) params.set("c", p.confirmation);
  if (p.levelUp) params.set("levelup", p.levelUp);
  if (p.recent && p.recent !== RECENT_STEP)
    params.set("recent", String(p.recent));
  if (p.range) params.set("range", p.range);
  if (p.bucket) params.set("bucket", p.bucket);
  const query = params.toString();
  return query ? `${BOARD}?${query}` : BOARD;
}
