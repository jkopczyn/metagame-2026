import { connection } from "next/server";
import SignIn from "../SignIn";
import { boardHref, parseBoardParams } from "./board-params";
import QuestSection from "./QuestSection";
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

  return <QuestSection params={params} viewer={viewer} />;
}
