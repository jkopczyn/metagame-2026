import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import SignIn from "../../SignIn";
import CardFit from "./CardFit";
import styles from "./card.module.css";
import QuestCard from "./QuestCard";
import { toolAccess } from "@/lib/admin-auth";
import { cardBackground } from "@/lib/megagame-quests";
import { listQuests, questsByIds } from "@/lib/megagame-store";
import { isUuid } from "../../megagame/uuid";

export const metadata: Metadata = {
  title: "Print quests — Metagame",
  robots: { index: false, follow: false },
};

/**
 * The cards to print: `?id=…&id=…` for chosen quests, else every active
 * quest, narrowed by `?class=wizard|pirate|alien|star`. Printed from the
 * browser; the tool header stays off this page.
 */
export default async function PrintQuests(
  props: PageProps<"/backstage/quests/print">,
) {
  await connection();
  const sp = await props.searchParams;
  if (!(await toolAccess("megagame.manage")))
    return <SignIn next="/backstage/quests" />;

  const ids = [sp.id ?? []].flat().filter(isUuid);
  const cls = [sp.class].flat()[0] ?? "";
  const quests =
    ids.length > 0
      ? await questsByIds(ids)
      : (await listQuests()).filter(
          (q) => q.active && (!cls || cardBackground(q) === cls),
        );

  return (
    <div className={styles.sheet}>
      <div className={styles.toolbar}>
        <Link href="/backstage/quests" className="text-navy underline">
          ← Quests
        </Link>
        <CardFit count={quests.length} />
      </div>
      {quests.length === 0 && (
        <p className="p-8 text-ink/70">No quests to print.</p>
      )}
      {quests.map((q) => (
        <QuestCard key={q.id} quest={q} />
      ))}
    </div>
  );
}
