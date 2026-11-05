import Link from "next/link";
import type { PlayerRow } from "./data";
import { levelsText, when } from "./format";
import { Avatar } from "./PlayerAdder";
import { boardHref, type BoardParams } from "./board-params";
import { withoutPlayer } from "./player-list";

const LINK =
  "text-sm text-ink/60 underline underline-offset-2 hover:text-meeple";

/** The current player list, each with its status and a Remove link. */
export default function PlayerRows({
  rows,
  params,
}: {
  rows: PlayerRow[];
  params: BoardParams;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-ink/60">No players added yet.</p>;
  }
  return (
    <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-white">
      {rows.map(({ player, status, completion }) => (
        <li key={player.id} className="flex gap-3 p-3">
          <Avatar player={player} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-navy">
              {player.name}
              {player.pronouns && (
                <span className="ml-2 text-sm font-normal text-ink/60">
                  {player.pronouns}
                </span>
              )}
            </p>
            <p className="text-sm text-ink/70">{levelsText(player.levels)}</p>
            {status.kind === "completed" ? (
              <p className="mt-1 text-sm font-semibold text-meeple">
                Already completed
                {completion &&
                  ` ${when(completion.at)}${completion.by ? ` by ${completion.by}` : ""}`}
                . Not recorded again.
              </p>
            ) : status.warnings.length > 0 ? (
              <ul className="mt-1 text-sm text-amber-800">
                {status.warnings.map((w) => (
                  <li key={w}>Warning: {w}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-green-800">OK</p>
            )}
            <div className="mt-1 flex gap-4">
              <Link
                href={boardHref({
                  ...params,
                  players: withoutPlayer(params.players, player.id),
                })}
                scroll={false}
                replace
                className={LINK}
              >
                Remove
              </Link>
              <Link
                href={`${boardHref({ ...params, levelUp: player.id })}#level-up`}
                replace
                className={LINK}
              >
                Level up
              </Link>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
