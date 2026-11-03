import Link from "next/link";
import { boardHref, type BoardParams } from "./board-params";
import { loadLevelUpTarget, loadListedPlayers } from "./data";
import { levelsText } from "./format";
import LevelUpForm from "./LevelUpForm";
import LevelUpPicker from "./LevelUpPicker";
import { Avatar } from "./PlayerAdder";
import Section from "./Section";

const SMALL_LINK =
  "text-sm text-ink/60 underline underline-offset-2 hover:text-meeple";
const CHIP =
  "rounded-full border border-line bg-white px-3 py-1.5 text-sm text-navy hover:border-navy";

export default async function LevelUpSection({
  params,
}: {
  params: BoardParams;
}) {
  const target = params.levelUp
    ? await loadLevelUpTarget(params.levelUp)
    : null;

  if (target) {
    const { player } = target;
    return (
      <Section
        id="level-up"
        title="Level up"
        aside={
          <Link
            href={boardHref({ ...params, levelUp: null })}
            replace
            scroll={false}
            className={SMALL_LINK}
          >
            Different player
          </Link>
        }
      >
        <div className="flex items-center gap-3 rounded-xl border border-line bg-white p-3">
          <Avatar player={player} />
          <div className="min-w-0">
            <p className="truncate font-medium text-navy">
              {player.name}
              {player.pronouns && (
                <span className="ml-2 text-sm font-normal text-ink/60">
                  {player.pronouns}
                </span>
              )}
            </p>
            <p className="text-sm text-ink/70">{levelsText(player.levels)}</p>
          </div>
        </div>
        <LevelUpForm
          key={player.id}
          id={crypto.randomUUID()}
          userId={player.id}
          name={player.name}
          levels={player.levels}
          completions={target.completions}
        />
      </Section>
    );
  }

  const listed = await loadListedPlayers(params.players);
  return (
    <Section id="level-up" title="Level up">
      {params.levelUp && (
        <p role="alert" className="text-sm text-meeple">
          That player was not found.
        </p>
      )}
      {listed.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-ink/80">From the list</p>
          <div className="flex flex-wrap gap-2">
            {listed.map((p) => (
              <Link
                key={p.id}
                href={boardHref({ ...params, levelUp: p.id })}
                replace
                scroll={false}
                className={CHIP}
              >
                {p.name}
              </Link>
            ))}
          </div>
        </div>
      )}
      <LevelUpPicker params={params} />
    </Section>
  );
}
