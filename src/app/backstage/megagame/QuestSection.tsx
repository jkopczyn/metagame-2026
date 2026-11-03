import Link from "next/link";
import { undoCompletion, undoConfirmation } from "./actions";
import AnswerChecker from "./AnswerChecker";
import { boardHref, type BoardParams } from "./board-params";
import ConfirmForm from "./ConfirmForm";
import {
  loadConfirmation,
  loadPlayerRows,
  loadQuest,
  type Viewer,
} from "./data";
import { windowText } from "./format";
import ListAdder from "./ListAdder";
import PlayerRows from "./PlayerRows";
import QuestCodeEntry from "./QuestCodeEntry";
import Section from "./Section";
import UndoForm from "./UndoForm";
import { CLASS_LABELS, isMegagameClass } from "@/lib/megagame-levels";
import type { Quest } from "@/lib/megagame-store";
import { formatTicketCode } from "@/lib/ticket-code-format";

const LINK =
  "font-semibold text-navy underline underline-offset-2 hover:text-meeple";
const SMALL_LINK =
  "text-sm text-ink/60 underline underline-offset-2 hover:text-meeple";

export default async function QuestSection({
  params,
  viewer,
  notice,
}: {
  params: BoardParams;
  viewer: Viewer;
  notice: string | null;
}) {
  const lookup = params.quest ? await loadQuest(params.quest) : null;
  const quest = lookup?.status === "open" ? lookup.quest : null;
  const shown =
    lookup?.status === "inactive" && params.confirmation ? lookup.quest : quest;

  return (
    <Section
      title="Quest"
      aside={
        params.quest && (
          <Link
            href={boardHref({ ...params, quest: null, confirmation: null })}
            replace
            scroll={false}
            className={SMALL_LINK}
          >
            Close quest
          </Link>
        )
      }
    >
      <QuestCodeEntry key={params.quest ?? ""} params={params} />
      {lookup?.status === "unknown" && (
        <p role="alert" className="text-sm text-meeple">
          No quest has code {formatTicketCode(params.quest!)}. Check the label
          and try again.
        </p>
      )}
      {lookup?.status === "inactive" && !shown && (
        <p role="alert" className="text-sm text-meeple">
          {lookup.quest.title} ({formatTicketCode(lookup.quest.code)}) is not
          active, so it can&rsquo;t be confirmed now.
        </p>
      )}
      {shown ? (
        <>
          <QuestHeader quest={shown} />
          {params.confirmation ? (
            <ConfirmationResult
              id={params.confirmation}
              quest={shown}
              params={params}
              viewer={viewer}
            />
          ) : (
            <CheckAndConfirm quest={shown} params={params} notice={notice} />
          )}
        </>
      ) : (
        <PlayerList params={params} quest={null} notice={notice} />
      )}
    </Section>
  );
}

function QuestHeader({ quest }: { quest: Quest }) {
  const facts = [
    quest.class && isMegagameClass(quest.class)
      ? CLASS_LABELS[quest.class]
      : quest.class || "Any class",
    windowText(quest),
    formatTicketCode(quest.code),
  ].filter(Boolean);
  return (
    <header className="flex flex-col gap-1 rounded-xl border border-line bg-white p-4">
      <h3 className="text-xl font-semibold text-navy">{quest.title}</h3>
      <p className="text-sm text-ink/70">{facts.join(" · ")}</p>
      {quest.hint && (
        <p className="text-sm text-ink/70">Hint for players: {quest.hint}</p>
      )}
    </header>
  );
}

async function PlayerList({
  params,
  quest,
  notice,
}: {
  params: BoardParams;
  quest: Quest | null;
  notice: string | null;
}) {
  const rows = await loadPlayerRows(params.players, quest);
  return <PlayerListView rows={rows} params={params} notice={notice} />;
}

function PlayerListView({
  rows,
  params,
  notice,
  children,
}: {
  rows: Awaited<ReturnType<typeof loadPlayerRows>>;
  params: BoardParams;
  notice: string | null;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-semibold text-navy">Players ({rows.length})</h3>
        {params.players.length > 0 && (
          <Link
            href={boardHref({ ...params, players: [] })}
            replace
            scroll={false}
            className={SMALL_LINK}
          >
            Clear list
          </Link>
        )}
      </div>
      {notice && (
        <p role="alert" className="text-sm text-meeple">
          {notice}
        </p>
      )}
      <PlayerRows rows={rows} params={params} />
      <ListAdder params={params} />
      {children}
    </div>
  );
}

async function CheckAndConfirm({
  quest,
  params,
  notice,
}: {
  quest: Quest;
  params: BoardParams;
  notice: string | null;
}) {
  const rows = await loadPlayerRows(params.players, quest);
  const recordable = rows
    .filter((r) => r.status.kind === "ok")
    .map((r) => r.player.id);
  return (
    <>
      <div className="flex flex-col gap-2">
        <h3 className="font-semibold text-navy">Check</h3>
        {quest.kind === "evidence" ? (
          <div className="rounded-xl border border-line bg-white p-4">
            <p className="text-sm font-medium text-ink/80">
              Look for evidence that
            </p>
            <p className="mt-1 text-lg text-ink">
              {quest.evidence || "No description given."}
            </p>
          </div>
        ) : (
          <AnswerChecker
            key={quest.code}
            questCode={quest.code}
            answers={quest.answers}
          />
        )}
      </div>
      <PlayerListView rows={rows} params={params} notice={notice}>
        <ConfirmForm
          id={crypto.randomUUID()}
          questId={quest.id}
          questCode={quest.code}
          players={recordable}
          list={params.players}
          board={boardHref(params).split("?")[1] ?? ""}
        />
      </PlayerListView>
    </>
  );
}

async function ConfirmationResult({
  id,
  quest,
  params,
  viewer,
}: {
  id: string;
  quest: Quest;
  params: BoardParams;
  viewer: Viewer;
}) {
  const view = await loadConfirmation(id, quest, viewer);
  const nextGroup = boardHref({ ...params, confirmation: null, players: [] });
  if (!view) {
    return (
      <div className="flex flex-col gap-2">
        <h3 className="font-semibold text-navy">Confirmation not found</h3>
        <Link href={nextGroup} className={LINK}>
          Start a group for this quest
        </Link>
      </div>
    );
  }
  const { outcome, nameOf, completionIds } = view;
  const name = (uid: string) => nameOf[uid] ?? "Deleted account";

  if (outcome.status === "voided") {
    return (
      <div className="flex flex-col gap-2">
        <h3 className="font-semibold text-navy">Undone</h3>
        <p className="text-ink/80">
          This confirmation was undone
          {outcome.confirmation.voidReason
            ? `: ${outcome.confirmation.voidReason}`
            : "."}
        </p>
        <Link href={nextGroup} className={LINK}>
          Start a new group
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-semibold text-navy">Recorded</h3>
      {outcome.recorded.length > 0 ? (
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-white">
          {outcome.recorded.map((uid) => (
            <li key={uid} className="flex flex-col gap-2 p-3">
              <span className="font-medium text-navy">{name(uid)}</span>
              {completionIds[uid] && (
                <UndoForm
                  action={undoCompletion}
                  id={completionIds[uid]}
                  label="Undo this player"
                />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink/80">Nobody new was recorded.</p>
      )}
      {outcome.alreadyCompleted.length > 0 && (
        <p className="text-sm text-meeple">
          Already completed earlier, not recorded again:{" "}
          {outcome.alreadyCompleted.map(name).join(", ")}.
        </p>
      )}
      {outcome.notRecorded.length > 0 && (
        <p className="text-sm text-meeple">
          Not recorded, or undone since:{" "}
          {outcome.notRecorded.map(name).join(", ")}.
        </p>
      )}
      {view.mayUndo && (
        <UndoForm action={undoConfirmation} id={id} label="Undo all" />
      )}
      <Link href={nextGroup} className={LINK}>
        Next group for this quest
      </Link>
    </div>
  );
}
