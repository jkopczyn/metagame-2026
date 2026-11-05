"use client";

import { useActionState } from "react";
import { chooseMegagameClass, type ClassState } from "./actions";
import {
  activeClasses,
  FACTION_NAMES,
  MEGAGAME_CLASSES,
  type MegagameClass,
  type MegagameLevels,
} from "@/lib/megagame-levels";
import ClassBadges from "@/v2/components/megagame/ClassBadges";
import FactionPatch from "@/v2/components/megagame/FactionPatch";
import GuildSeal from "@/v2/components/megagame/GuildSeal";

const BRIEFS: Record<MegagameClass, string> = {
  wizard:
    "The Astral College is looking for studious wizards and witches who have the wits and the words to help us complete our grand spell research.",
  pirate:
    "The Brethren Fleet is looking for adventurous and cunning pirates to navigate through Lighthaven and find the legendary treasure hidden there!",
  alien:
    "The Galactic Survey has recently crashed and is looking for clever members to join our survey and help solve the puzzle of how to get home.",
};

// Shown on hover or focus where there's a mouse; always on touch screens and
// phones, which have no hover.
const BRIEF =
  "text-[15px] leading-snug text-ink/80 transition duration-200 sm:pointer-fine:translate-y-1 sm:pointer-fine:opacity-0 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100";

export default function MegagamePanel({
  levels,
  badgeCode,
  locked,
}: {
  levels: MegagameLevels;
  /** The four digits on the ticket this account claimed; null until assigned. */
  badgeCode: string | null;
  /** A volunteer has recorded a level-up, so the picker no longer applies. */
  locked: boolean;
}) {
  const [state, action, pending] = useActionState<ClassState, FormData>(
    chooseMegagameClass,
    {},
  );
  const joined = activeClasses(levels).length > 0;
  return (
    <div className="flex max-w-[960px] flex-col gap-10">
      <section className="flex flex-col gap-1">
        <h2 className="font-grotesk text-2xl font-bold text-navy">
          Your badge
        </h2>
        {badgeCode === null ? (
          <p className="text-sm text-ink/70">
            Your badge number is not assigned yet.
          </p>
        ) : (
          <>
            <p className="text-navy">
              Badge number{" "}
              <span className="font-space-mono text-3xl font-bold tracking-[0.12em]">
                {badgeCode}
              </span>
            </p>
            <p className="text-sm text-ink/70">
              Read this out to a megagame volunteer when you finish a quest.
            </p>
          </>
        )}
      </section>
      {(joined || locked) && (
        <section className="flex flex-col gap-4">
          <h2 className="font-grotesk text-2xl font-bold text-navy">
            Your classes
          </h2>
          <ClassBadges levels={levels} />
          {locked && (
            <p className="text-sm text-ink/70">
              A megagame volunteer has recorded a level for you, so your classes
              now change only at the volunteer desk.
            </p>
          )}
        </section>
      )}

      {!locked && (
        <section
          aria-labelledby="guild-notice"
          className="rounded-2xl border-2 border-navy bg-[#FFFBF2] px-5 py-8 sm:px-10 sm:py-10"
        >
          <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:items-start sm:gap-8 sm:text-left">
            <GuildSeal className="size-24 shrink-0 -rotate-6 sm:size-32" />
            <div>
              <p className="font-space-mono text-xs font-bold tracking-[0.16em] text-meeple uppercase sm:text-sm">
                Adventurers Guild · Notice
              </p>
              <h2
                id="guild-notice"
                className="mt-2 font-[family-name:var(--font-bebas)] text-[clamp(34px,5.2vw,54px)] leading-[0.95] tracking-[0.02em] text-navy"
              >
                Important announcement from the Adventurers Guild!
              </h2>
              <p className="mt-4 max-w-[62ch] text-lg leading-relaxed text-ink/80">
                Chaos is breaking out all over Lighthaven: magic is in the air,
                a spaceship has crash-landed, and rumors of a buried treasure
                are floating about. If you’d like to help, three factions have
                reached out to us looking for new members. Please select one of
                them to join, and recruit your friends to help you on your
                quests!
              </p>
            </div>
          </div>

          <div className="my-8 flex items-center gap-4" aria-hidden>
            <span className="h-px flex-1 border-t-2 border-dashed border-navy/25" />
            <span className="font-space-mono text-xs font-bold tracking-[0.16em] text-navy/70 uppercase">
              Pick a faction
            </span>
            <span className="h-px flex-1 border-t-2 border-dashed border-navy/25" />
          </div>

          <form
            action={action}
            aria-busy={pending}
            className="grid gap-6 sm:grid-cols-3 sm:gap-8"
          >
            {MEGAGAME_CLASSES.map((c) => {
              const level = levels[c];
              return (
                <button
                  key={c}
                  type="submit"
                  name="class"
                  value={c}
                  disabled={pending || level > 0}
                  aria-label={
                    level > 0
                      ? `${FACTION_NAMES[c]}: joined, level ${level}`
                      : `Join the ${FACTION_NAMES[c]}`
                  }
                  aria-describedby={`brief-${c}`}
                  className="group flex items-center gap-4 rounded-2xl p-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-navy enabled:cursor-pointer disabled:cursor-default sm:flex-col sm:gap-3 sm:text-center"
                >
                  <span className="relative w-36 shrink-0 sm:w-full sm:max-w-[240px]">
                    <FactionPatch
                      faction={c}
                      className="w-full transition-transform duration-200 group-enabled:group-hover:-translate-y-1.5 group-enabled:group-hover:-rotate-2"
                    />
                    {level > 0 && (
                      <span className="absolute -top-2 left-1/2 -translate-x-1/2 rotate-[-4deg] rounded-full border-2 border-navy bg-tan px-3 py-0.5 font-space-mono text-[11px] font-bold tracking-[0.08em] whitespace-nowrap text-navy uppercase">
                        Joined · Lv {level}
                      </span>
                    )}
                  </span>
                  <span id={`brief-${c}`} className={BRIEF}>
                    {BRIEFS[c]}
                  </span>
                </button>
              );
            })}
          </form>
          {state.error && (
            <p role="alert" className="mt-4 text-sm text-meeple">
              {state.error}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
