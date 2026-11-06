import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import SignIn from "../../../SignIn";
import { smallButtonClass } from "../../../ui";
import DeleteQuestForm from "../../DeleteQuestForm";
import QuestForm from "../../QuestForm";
import { toolAccess } from "@/lib/admin-auth";
import { questInputOf } from "@/lib/megagame-quests";
import { getQuest } from "@/lib/megagame-store";
import { isUuid } from "../../../megagame/uuid";
import { formatTicketCode } from "@/lib/ticket-code-format";

export default async function EditQuest(
  props: PageProps<"/backstage/quests/[id]">,
) {
  await connection();
  const { id } = await props.params;
  const sp = await props.searchParams;
  if (!(await toolAccess("megagame.manage")))
    return <SignIn next={`/backstage/quests/${id}`} />;
  const quest = isUuid(id) ? await getQuest(id) : null;
  if (!quest) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-bebas text-3xl tracking-wide text-navy">
            {quest.title}
          </h1>
          <p className="text-sm text-ink/60">
            Code{" "}
            <span className="font-mono">{formatTicketCode(quest.code)}</span>
            {" · "}
            <a
              href={`/q/${quest.code}`}
              className="underline underline-offset-2"
            >
              /q/{quest.code}
            </a>
            {!quest.active && " · withdrawn"}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/backstage/quests/print?id=${quest.id}`}
            target="_blank"
            className={smallButtonClass}
          >
            Print card
          </Link>
          <Link
            href={`/backstage/megagame?quest=${quest.code}`}
            className={smallButtonClass}
          >
            Open on the board
          </Link>
        </div>
      </div>
      {[sp.saved].flat()[0] && (
        <p role="status" className="text-sm text-moss">
          Saved.
        </p>
      )}
      <QuestForm
        key={quest.updatedAt.toISOString()}
        id={quest.id}
        initial={questInputOf(quest)}
      />
      <DeleteQuestForm id={quest.id} code={quest.code} />
    </div>
  );
}
