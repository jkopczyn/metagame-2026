"use client";

import { useActionState, useState } from "react";
import { saveQuest, type QuestFormState } from "./actions";
import ImagePicker from "./ImagePicker";
import { buttonClass, fieldClass, selectClass, selectStyle } from "../ui";
import {
  CLASS_LABELS,
  MAX_LEVEL,
  MEGAGAME_CLASSES,
  type MegagameClass,
} from "@/lib/megagame-levels";
import {
  AUTHOR_MAX,
  MAX_BODY_IMAGES,
  MAX_MIN_PLAYERS,
  MAX_STAMPS,
  TITLE_MAX,
  type QuestInput,
} from "@/lib/megagame-quests";

const LABEL = "text-sm font-medium text-ink/80";
const NUM = `${fieldClass} w-24 tabular-nums`;

const EMPTY: QuestInput = {
  title: "",
  bodyText: "",
  bodyImages: [],
  class: null,
  minLevel: null,
  maxLevel: null,
  minPlayers: 1,
  stamps: { wizard: 0, pirate: 0, alien: 0, any: 0 },
  evidence: null,
  evidenceImage: null,
  hint: null,
  author: null,
  active: true,
};

/** One quest's fields. With `id` it saves over that quest, else it creates one. */
export default function QuestForm({
  id,
  initial = EMPTY,
}: {
  id?: string;
  initial?: QuestInput;
}) {
  const [state, action, pending] = useActionState<QuestFormState, FormData>(
    saveQuest,
    {},
  );
  const [cls, setCls] = useState<MegagameClass | "">(initial.class ?? "");

  return (
    <form action={action} aria-busy={pending} className="flex flex-col gap-6">
      {id && <input type="hidden" name="id" value={id} />}

      <label className="flex flex-col gap-1">
        <span className={LABEL}>Title</span>
        <input
          name="title"
          required
          maxLength={TITLE_MAX}
          defaultValue={initial.title}
          className={fieldClass}
        />
      </label>

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Class</span>
          <select
            name="class"
            value={cls}
            onChange={(e) => setCls(e.target.value as MegagameClass | "")}
            className={selectClass}
            style={selectStyle}
          >
            <option value="">Any class</option>
            {MEGAGAME_CLASSES.map((c) => (
              <option key={c} value={c}>
                {CLASS_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Min level</span>
          <input
            name="minLevel"
            type="number"
            min={1}
            max={MAX_LEVEL}
            defaultValue={initial.minLevel ?? ""}
            disabled={cls === ""}
            className={NUM}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Max level</span>
          <input
            name="maxLevel"
            type="number"
            min={1}
            max={MAX_LEVEL}
            defaultValue={initial.maxLevel ?? ""}
            disabled={cls === ""}
            className={NUM}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Min players</span>
          <input
            name="minPlayers"
            type="number"
            min={1}
            max={MAX_MIN_PLAYERS}
            defaultValue={initial.minPlayers}
            className={NUM}
          />
        </label>
        <p className="max-w-xs text-xs text-ink/60">
          A classed quest gets that class&rsquo;s card art and a level window
          the board warns about; any-class quests get the star.
        </p>
      </div>

      <label className="flex flex-col gap-1">
        <span className={LABEL}>Quest text</span>
        <textarea
          name="bodyText"
          rows={8}
          defaultValue={initial.bodyText}
          className={fieldClass}
          placeholder="What the card says. Blank lines separate paragraphs; nothing else is formatted."
        />
      </label>

      <ImagePicker
        name="bodyImages"
        label={`Pictures on the card (up to ${MAX_BODY_IMAGES})`}
        initial={initial.bodyImages}
        max={MAX_BODY_IMAGES}
        hint="Printed under the text in this order. Shrunk to 2400px on upload."
      />

      <fieldset className="flex flex-col gap-2">
        <legend className={LABEL}>Reward stamps</legend>
        <div className="flex flex-wrap gap-4">
          {(
            [
              ["stampsWizard", "Wizard", initial.stamps.wizard],
              ["stampsPirate", "Pirate", initial.stamps.pirate],
              ["stampsAlien", "Alien", initial.stamps.alien],
              ["stampsAny", "Any class", initial.stamps.any],
            ] as const
          ).map(([name, label, value]) => (
            <label key={name} className="flex flex-col gap-1">
              <span className="text-xs text-ink/70">{label}</span>
              <input
                name={name}
                type="number"
                min={0}
                max={MAX_STAMPS}
                defaultValue={value}
                className={NUM}
              />
            </label>
          ))}
        </div>
        <p className="text-xs text-ink/60">
          &ldquo;Any class&rdquo; stamps go to a class of the player&rsquo;s
          choosing.
        </p>
      </fieldset>

      <label className="flex flex-col gap-1">
        <span className={LABEL}>Evidence</span>
        <textarea
          name="evidence"
          rows={4}
          defaultValue={initial.evidence ?? ""}
          className={fieldClass}
          placeholder="What the volunteer checks for: the answer, what the finished thing looks like, who to have signed off…"
        />
      </label>

      <ImagePicker
        name="evidenceImage"
        label="Evidence picture"
        initial={initial.evidenceImage ? [initial.evidenceImage] : []}
        max={1}
        hint="Shown to the volunteer only, never printed."
      />

      <label className="flex flex-col gap-1">
        <span className={LABEL}>Hint for players</span>
        <input
          name="hint"
          defaultValue={initial.hint ?? ""}
          className={fieldClass}
          placeholder="Optional nudge the volunteer may give a stuck group."
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className={LABEL}>Author</span>
        <input
          name="author"
          maxLength={AUTHOR_MAX}
          defaultValue={initial.author ?? ""}
          className={fieldClass}
          placeholder="Printed at the foot of the card. Optional."
        />
      </label>

      <label className="flex items-center gap-2 text-sm text-ink/80">
        <input type="checkbox" name="active" defaultChecked={initial.active} />
        Active: the board confirms it and &ldquo;Print all&rdquo; includes it
      </label>

      {state.errors && (
        <ul role="alert" className="list-disc pl-5 text-sm text-meeple">
          {state.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <button
        type="submit"
        disabled={pending}
        className={`${buttonClass} sm:w-auto`}
      >
        {pending ? "Saving…" : id ? "Save quest" : "Add quest"}
      </button>
    </form>
  );
}
