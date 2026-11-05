"use client";

import { useCallback, useState } from "react";
import { smallButtonClass } from "../ui";
import { lookupPlayer, type PlayerHit } from "./actions";
import QrScanner from "./QrScanner";
import { routeScan } from "./scan-route";
import { formatBadgeCode } from "@/lib/badge-code";
import { formatTicketCode } from "@/lib/ticket-code-format";

const addedNext = (name: string) => `Added ${name}. Scan the next badge.`;

/**
 * A Scan button that opens the camera. A badge's four-digit number adds a
 * player; a quest label opens the quest. Without a handler for a kind, that
 * kind is reported instead of acted on.
 */
export default function ScanCodes({
  label,
  onPlayer,
  onQuest,
  addedMessage = addedNext,
}: {
  label: string;
  onPlayer?: (player: PlayerHit) => void;
  onQuest?: (code: string) => void;
  addedMessage?: (name: string) => string;
}) {
  const [open, setOpen] = useState(false);

  const onDecode = useCallback(
    async (payload: string): Promise<string> => {
      const route = routeScan(payload, {
        quest: !!onQuest,
        player: !!onPlayer,
      });
      if ("message" in route) return route.message;
      if (route.kind === "quest") {
        onQuest!(route.code);
        return `Opening quest ${formatTicketCode(route.code)}…`;
      }
      const res = await lookupPlayer(formatBadgeCode(route.badgeNumber));
      if (!res.player) return res.error ?? "Lookup failed.";
      onPlayer!(res.player);
      return addedMessage(res.player.name);
    },
    [onPlayer, onQuest, addedMessage],
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${smallButtonClass} self-start`}
      >
        {label}
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <QrScanner onDecode={onDecode} />
      <button
        type="button"
        onClick={() => setOpen(false)}
        className={`${smallButtonClass} self-start`}
      >
        Stop scanning
      </button>
    </div>
  );
}
