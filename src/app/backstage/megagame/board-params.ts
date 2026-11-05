import { parsePlayerIds } from "./player-list";
import { isUuid } from "./uuid";
import { normalizeMegagameCode } from "@/lib/megagame-rules";

// Everything the Quest Board shows is chosen by its query parameters, so a
// reload, a tab switch or a camera detour keeps it.

export const BOARD = "/backstage/megagame";

export type BoardParams = {
  /** Normalized, possibly incomplete, so the page can say it was not found. */
  quest: string | null;
  players: string[];
  /**
   * Row ids the last confirm recorded, kept so "Undo all" survives a reload.
   * Null when no result is showing; empty when it recorded nobody new.
   */
  done: string[] | null;
};

export type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) =>
  ([v].flat()[0] ?? "").trim();

export function parseBoardParams(sp: SearchParams): BoardParams {
  const quest = normalizeMegagameCode(first(sp.quest)).slice(0, 12);
  return {
    quest: quest || null,
    players: parsePlayerIds(sp.players),
    done: sp.done === undefined ? null : parsePlayerIds(sp.done).filter(isUuid),
  };
}

export function boardHref(p: Partial<BoardParams>): string {
  const params = new URLSearchParams();
  if (p.quest) params.set("quest", p.quest);
  if (p.players && p.players.length > 0)
    params.set("players", p.players.join(","));
  if (p.done) params.set("done", p.done.join(","));
  const query = params.toString();
  return query ? `${BOARD}?${query}` : BOARD;
}
