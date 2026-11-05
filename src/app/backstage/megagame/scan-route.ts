import {
  isCompleteMegagameCode,
  normalizeBadgeNumber,
  normalizeMegagameCode,
  parseScannedCode,
  type ScannedCode,
} from "@/lib/megagame-rules";
import { BOARD } from "./board-params";

export type ScanRoute = ScannedCode | { message: string };

/** A badge's bare number is a player; a /q/ link or six-character code is a quest. */
export function routeScan(
  payload: string,
  handles: { quest: boolean; player: boolean },
): ScanRoute {
  const scanned = boardLink(payload) ?? parseScannedCode(payload);
  if (!scanned)
    return { message: "That QR code is not a quest label or a badge." };
  if (scanned.kind === "quest" && !handles.quest) {
    return { message: "That is a quest label. Scan a player's badge." };
  }
  if (scanned.kind === "player" && !handles.player) {
    return { message: "That is a player's badge. Scan a quest label." };
  }
  return scanned;
}

/** A Quest Board link such as /backstage/megagame?quest=<code>. */
function boardLink(payload: string): ScannedCode | null {
  let url: URL;
  try {
    url = new URL(payload.trim(), "https://x.invalid");
  } catch {
    return null;
  }
  if (url.pathname.replace(/\/+$/, "") !== BOARD) return null;
  const quest = url.searchParams.get("quest");
  if (quest !== null) {
    const code = normalizeMegagameCode(quest);
    return isCompleteMegagameCode(code) ? { kind: "quest", code } : null;
  }
  const player = url.searchParams.get("player");
  if (player !== null) {
    const badgeNumber = normalizeBadgeNumber(player);
    return badgeNumber === null ? null : { kind: "player", badgeNumber };
  }
  return null;
}
