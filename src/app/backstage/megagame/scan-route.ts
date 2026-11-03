import {
  isCompleteMegagameCode,
  normalizeMegagameCode,
  parseScannedCode,
  type ScannedCode,
} from "@/lib/megagame-rules";
import { BOARD } from "./board-params";

export type ScanRoute =
  | { kind: "quest" | "player"; code: string }
  | { message: string };

/** A bare code counts as `bareKind`; a /q/ or /p/ link says what it is. */
export function routeScan(
  payload: string,
  bareKind: "quest" | "player",
  handles: { quest: boolean; player: boolean },
): ScanRoute {
  const scanned = boardLink(payload) ?? parseScannedCode(payload);
  if (!scanned)
    return { message: "That QR code is not a quest label or a badge." };
  const kind = scanned.kind ?? bareKind;
  if (kind === "quest" && !handles.quest) {
    return { message: "That is a quest label. Scan a player's badge." };
  }
  if (kind === "player" && !handles.player) {
    return { message: "That is a player's badge. Scan a quest label." };
  }
  return { kind, code: scanned.code };
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
  for (const kind of ["quest", "player"] as const) {
    const raw = url.searchParams.get(kind);
    if (raw === null) continue;
    const code = normalizeMegagameCode(raw);
    return isCompleteMegagameCode(code) ? { kind, code } : null;
  }
  return null;
}
