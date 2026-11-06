import Link from "next/link";
import { undoCompletions, undoLevelUp } from "./actions";
import {
  RECENT_MAX,
  RECENT_STEP,
  boardHref,
  type BoardParams,
} from "./board-params";
import { loadRecentActions, type RecentAction, type Viewer } from "./data";
import { when } from "./format";
import Section from "./Section";
import UndoForm from "./UndoForm";
import { CLASS_LABELS, isMegagameClass } from "@/lib/megagame-levels";

const NOTE = "text-sm text-ink/60";
const SMALL_LINK =
  "text-sm text-ink/60 underline underline-offset-2 hover:text-meeple";

const classLabel = (c: string | null) =>
  c === null ? "Any class" : isMegagameClass(c) ? CLASS_LABELS[c] : c;
const who = (name: string | null) => name ?? "a deleted account";

export default async function RecentActions({
  params,
  viewer,
}: {
  params: BoardParams;
  viewer: Viewer;
}) {
  const { actions, more } = await loadRecentActions(params.recent, viewer);
  return (
    <Section title="Recent actions">
      {actions.length === 0 ? (
        <p className={NOTE}>Nothing recorded yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-white">
          {actions.map((a) => (
            <li key={a.key} className="flex flex-col gap-1 p-3 text-sm">
              <ActionText action={a} params={params} />
            </li>
          ))}
        </ul>
      )}
      {more && params.recent < RECENT_MAX && (
        <Link
          href={boardHref({ ...params, recent: params.recent + RECENT_STEP })}
          replace
          scroll={false}
          className={`${SMALL_LINK} self-start`}
        >
          Show more
        </Link>
      )}
    </Section>
  );
}

function Header({
  title,
  at,
  voided,
}: {
  title: React.ReactNode;
  at: Date;
  voided?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span
        className={`min-w-0 font-medium text-navy ${voided ? "line-through opacity-60" : ""}`}
      >
        {title}
      </span>
      <span className="shrink-0 text-ink/60">{when(at)}</span>
    </div>
  );
}

function ActionText({
  action,
  params,
}: {
  action: RecentAction;
  params: BoardParams;
}) {
  if (action.kind === "completion") {
    const c = action.item;
    return (
      <>
        <Header
          voided={c.undoneAt !== null}
          at={action.at}
          title={
            <>
              {c.playerName ?? "A deleted account"} completed{" "}
              <Link
                href={boardHref({ ...params, quest: c.questCode, done: null })}
                scroll={false}
                className="underline-offset-2 hover:text-meeple hover:underline"
              >
                {c.questTitle}
              </Link>
            </>
          }
        />
        <p className="text-ink/70">
          Confirmed by {who(c.confirmedByName)}
          {c.undoneAt &&
            ` · undone by ${who(c.undoneByName)}${c.undoReason ? `: ${c.undoReason}` : ""}`}
        </p>
        {action.mayUndo && <UndoForm action={undoCompletions} ids={[c.id]} />}
      </>
    );
  }
  if (action.kind === "level") {
    const e = action.item;
    return (
      <>
        <Header
          voided={e.voidedAt !== null}
          at={action.at}
          title={`${e.playerName ?? "A deleted account"} to level ${e.level} ${classLabel(e.class)}`}
        />
        <p className="text-ink/70">
          Recorded by {who(e.awardedByName)}
          {!e.checksPassed &&
            ` · recorded anyway${e.overrideReason ? `: ${e.overrideReason}` : ""}`}
          {e.voidedAt && " · undone"}
        </p>
        {e.note && <p className="text-ink/70">Note: {e.note}</p>}
        {e.cardPhotoUrl && (
          <a
            href={e.cardPhotoUrl}
            target="_blank"
            rel="noreferrer"
            className={`${SMALL_LINK} self-start`}
          >
            Record card photo
          </a>
        )}
        {action.mayUndo && <UndoForm action={undoLevelUp} ids={[e.id]} />}
      </>
    );
  }
  const v = action.item;
  const player = v.playerName ?? "a deleted account";
  return (
    <>
      <Header
        at={action.at}
        title={`Undid ${player} at level ${v.level} ${classLabel(v.class)}`}
      />
      <p className="text-ink/70">
        By {who(v.voidedByName)}
        {v.reason ? `: ${v.reason}` : ""}
      </p>
    </>
  );
}
