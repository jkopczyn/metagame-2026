import Link from "next/link";
import {
  activeClasses,
  MEGAGAME_CLASSES,
  type MegagameLevels,
} from "@/lib/megagame-levels";
import ClassBadges from "@/v2/components/megagame/ClassBadges";
import { FactionMedal } from "@/v2/components/megagame/FactionPatch";

const TAB_LINK =
  "font-space-mono text-xs font-bold tracking-[0.12em] text-navy uppercase underline-offset-4 hover:text-meeple hover:underline";

/** The profile tab's Megagame line: your class badges, or a nudge to pick one. */
export default function MegagameSummary({
  levels,
}: {
  levels: MegagameLevels;
}) {
  if (activeClasses(levels).length > 0) {
    return (
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <ClassBadges levels={levels} />
        <Link href="/account?tab=megagame" className={TAB_LINK}>
          Megagame →
        </Link>
      </div>
    );
  }
  return (
    <Link
      href="/account?tab=megagame"
      className="group flex w-fit items-center gap-4 rounded-2xl border-2 border-navy bg-[#FFFBF2] py-3 pr-6 pl-3 transition-colors hover:bg-white"
    >
      <span className="flex -space-x-3">
        {MEGAGAME_CLASSES.map((c) => (
          <FactionMedal
            key={c}
            faction={c}
            className="size-11 rounded-full ring-2 ring-[#FFFBF2]"
          />
        ))}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="font-[family-name:var(--font-bebas)] text-[22px] leading-none tracking-[0.04em] text-navy">
          Join a Megagame faction
        </span>
        <span className="text-sm text-ink/70">
          The Adventurers Guild is recruiting →
        </span>
      </span>
    </Link>
  );
}
