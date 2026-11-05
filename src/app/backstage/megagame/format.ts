import {
  activeClasses,
  classLevelLabel,
  type MegagameLevels,
} from "@/lib/megagame-levels";
import { PACIFIC } from "@/lib/schedule";

const WHEN = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC,
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

/** "Sat 3:42 PM", in con time. */
export const when = (at: Date) => WHEN.format(at);

/** "Level 2 Wizard, Level 1 Alien", or a note when there are none. */
export function levelsText(levels: MegagameLevels): string {
  const active = activeClasses(levels);
  if (active.length === 0) return "No class yet";
  return active.map((a) => classLevelLabel(a.class, a.level)).join(", ");
}

/** "Levels 2 to 3", "Level 2 and up", "Up to level 3", or null for no window. */
export function windowText(q: {
  minLevel: number | null;
  maxLevel: number | null;
}): string | null {
  if (q.minLevel != null && q.maxLevel != null) {
    return `Levels ${q.minLevel} to ${q.maxLevel}`;
  }
  if (q.minLevel != null) return `Level ${q.minLevel} and up`;
  if (q.maxLevel != null) return `Up to level ${q.maxLevel}`;
  return null;
}
