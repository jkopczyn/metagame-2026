"use client";

import { useActionState, useState } from "react";
import { buttonClass, fieldClass, selectClass, selectStyle } from "../ui";
import { levelUp, undoLevelUp, type LevelUpState } from "./actions";
import UndoForm from "./UndoForm";
import { downscaleImage } from "@/lib/downscale-image";
import {
  CLASS_LABELS,
  MAX_LEVEL,
  MEGAGAME_CLASSES,
  activeClasses,
  classLevelLabel,
  isMegagameClass,
  type MegagameClass,
  type MegagameLevels,
} from "@/lib/megagame-levels";
import { checkLevelUp } from "@/lib/megagame-rules";

const CARD_PX = 1600;
// The server refuses anything over 900 KB.
const CARD_MAX_BYTES = 850 * 1024;

async function shrinkPhoto(formData: FormData): Promise<string | null> {
  const photo = formData.get("photo");
  if (!(photo instanceof File) || photo.size === 0) {
    formData.delete("photo");
    return null;
  }
  try {
    let small = await downscaleImage(photo, CARD_PX);
    if (small.size > CARD_MAX_BYTES) {
      small = await downscaleImage(photo, CARD_PX * 0.7);
    }
    formData.set("photo", small);
    return null;
  } catch {
    return "Couldn’t read that photo.";
  }
}

/**
 * `id` is minted per server render: a retry reuses it, and the page re-renders
 * with a fresh one after a level is recorded.
 */
export default function LevelUpForm({
  id,
  userId,
  name,
  levels,
  completions,
}: {
  id: string;
  userId: string;
  name: string;
  levels: MegagameLevels;
  completions: Record<MegagameClass, number>;
}) {
  const [cls, setCls] = useState<MegagameClass>(
    () => activeClasses(levels)[0]?.class ?? "wizard",
  );
  const [picked, setPicked] = useState<number | null>(null);
  const current = levels[cls];
  const level = picked !== null && picked > current ? picked : current + 1;
  const atMax = current >= MAX_LEVEL;

  const [state, run, pending] = useActionState(
    async (prev: LevelUpState, formData: FormData) => {
      const problem = await shrinkPhoto(formData);
      if (problem) return { error: problem };
      return levelUp(prev, formData);
    },
    {},
  );

  const check = checkLevelUp({
    class: cls,
    level,
    levels,
    completionsInClass: completions[cls],
  });
  const warnings = [...new Set([...check.warnings, ...(state.warnings ?? [])])];

  return (
    <div className="flex flex-col gap-4">
      {state.awarded && isMegagameClass(state.awarded.class) && (
        <div className="flex flex-col gap-2 rounded-xl border border-green-700/30 bg-green-50 p-3">
          <p className="font-semibold text-green-900">
            Recorded {classLevelLabel(state.awarded.class, state.awarded.level)}{" "}
            for {name}.
          </p>
          <UndoForm action={undoLevelUp} ids={[state.awarded.eventId]} />
        </div>
      )}

      <form action={run} className="flex flex-col gap-4">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="class" value={cls} />

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-ink/80">
            Class
          </legend>
          <div className="grid grid-cols-3 gap-2">
            {MEGAGAME_CLASSES.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={c === cls}
                onClick={() => {
                  setCls(c);
                  setPicked(null);
                }}
                className={`rounded-lg border px-2 py-2.5 text-center ${
                  c === cls
                    ? "border-navy bg-navy text-white"
                    : "border-line bg-white text-ink hover:border-navy"
                }`}
              >
                <span className="block font-semibold">{CLASS_LABELS[c]}</span>
                <span className="block text-xs opacity-80">
                  now {levels[c]}
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        {atMax ? (
          <p className="text-sm text-meeple">
            Already at level {MAX_LEVEL}, the maximum, in this class.
          </p>
        ) : (
          <>
            <label className="flex flex-col gap-2 text-sm font-medium text-ink/80">
              New level
              <select
                name="level"
                value={level}
                onChange={(e) => setPicked(Number(e.target.value))}
                className={selectClass}
                style={selectStyle}
              >
                {Array.from(
                  { length: MAX_LEVEL - current },
                  (_, i) => current + 1 + i,
                ).map((n) => (
                  <option key={n} value={n}>
                    Level {n}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-sm text-ink/60">
              {completions[cls]} completed {cls}{" "}
              {completions[cls] === 1 ? "quest" : "quests"}.
            </p>

            <label className="flex flex-col gap-2 text-sm font-medium text-ink/80">
              Record card photo (optional)
              <input
                type="file"
                name="photo"
                accept="image/*"
                capture="environment"
                className="text-sm"
              />
            </label>

            <label className="flex flex-col gap-2 text-sm font-medium text-ink/80">
              Note (optional)
              <input name="note" maxLength={500} className={fieldClass} />
            </label>

            {!check.ok && (
              <p role="alert" className="text-sm text-meeple">
                {check.errors[0]}
              </p>
            )}

            {warnings.length > 0 && (
              <div className="flex flex-col gap-2 rounded-xl border border-amber-600/40 bg-amber-50 p-3">
                <ul className="text-sm text-amber-900">
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
                <label className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <input type="checkbox" name="sure" required />
                  Yes, I&rsquo;m sure
                </label>
                <input
                  name="reason"
                  maxLength={500}
                  placeholder="Reason (optional)"
                  aria-label="Reason for recording anyway"
                  className={fieldClass}
                />
              </div>
            )}

            <button
              type="submit"
              disabled={pending || !check.ok}
              className={buttonClass}
            >
              {pending
                ? "Recording…"
                : warnings.length > 0
                  ? "Record anyway"
                  : `Record level ${level}`}
            </button>
          </>
        )}
        {state.error && (
          <p role="alert" className="text-sm text-meeple">
            {state.error}
          </p>
        )}
      </form>
    </div>
  );
}
