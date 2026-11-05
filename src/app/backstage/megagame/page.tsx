import { connection } from "next/server";
import SignIn from "../SignIn";
import { boardHref, parseBoardParams } from "./board-params";
import LevelUpSection from "./LevelUpSection";
import QuestSection from "./QuestSection";
import RecentActions from "./RecentActions";
import { toolAccess } from "@/lib/admin-auth";

export default async function QuestBoard(
  props: PageProps<"/backstage/megagame">,
) {
  await connection();
  const params = parseBoardParams(await props.searchParams);

  const access = await toolAccess("megagame.verify");
  if (!access) return <SignIn next={boardHref(params)} />;

  const viewer = {
    userId: access.userId,
    manager: Boolean(await toolAccess("megagame.manage")),
  };

  return (
    <>
      {/* Side by side on wide screens; the phone keeps the top-to-bottom order. */}
      <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
        <div className="min-w-0">
          <QuestSection params={params} viewer={viewer} />
        </div>
        <div className="min-w-0">
          <LevelUpSection params={params} />
        </div>
      </div>
      <RecentActions params={params} viewer={viewer} />
    </>
  );
}
