import { redirect } from "next/navigation";
import { connection } from "next/server";
import SignIn from "../SignIn";
import { boardHref, parseBoardParams } from "./board-params";
import LevelUpSection from "./LevelUpSection";
import OverTime from "./OverTime";
import { withPlayer } from "./player-list";
import QuestSection from "./QuestSection";
import RecentActions from "./RecentActions";
import { toolAccess } from "@/lib/admin-auth";
import { formatBadgeCode } from "@/lib/badge-code";
import { normalizeBadgeNumber } from "@/lib/megagame-rules";
import { findPlayerByBadgeNumber } from "@/lib/megagame-store";

export default async function QuestBoard(
  props: PageProps<"/backstage/megagame">,
) {
  await connection();
  const sp = await props.searchParams;
  const params = parseBoardParams(sp);
  const added = [sp.player].flat()[0];

  const access = await toolAccess("megagame.verify");
  if (!access) {
    const href = boardHref(params);
    const next = added
      ? `${href}${href.includes("?") ? "&" : "?"}player=${encodeURIComponent(added)}`
      : href;
    return <SignIn next={next} />;
  }

  // ?player=<badge number> adds that player to the list.
  let notice: string | null = null;
  const badge = added ? normalizeBadgeNumber(added) : null;
  if (added && badge === null) {
    notice = `${added.slice(0, 20)} is not a badge number.`;
  } else if (badge !== null) {
    const player = await findPlayerByBadgeNumber(badge);
    if (player) {
      redirect(
        boardHref({
          ...params,
          players: withPlayer(params.players, player.id),
        }),
      );
    }
    notice = `No player has badge number ${formatBadgeCode(badge)}.`;
  }

  const viewer = {
    userId: access.userId,
    manager: Boolean(await toolAccess("megagame.manage")),
  };

  return (
    <>
      {/* Side by side on wide screens; the phone keeps the top-to-bottom order. */}
      <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
        <div className="min-w-0">
          <QuestSection params={params} viewer={viewer} notice={notice} />
        </div>
        <div className="min-w-0">
          <LevelUpSection params={params} />
        </div>
      </div>
      <RecentActions params={params} viewer={viewer} />
      <OverTime params={params} />
    </>
  );
}
