"use client";

import { useActionState, useState } from "react";
import InfoTip from "../InfoTip";
import { submitGrades, type SaveState } from "../actions";
import {
  keepingSavedAt,
  retryable,
  submitKeepingDraft,
} from "@/lib/action-retry";
import {
  ADVANCE_FIELD,
  SPACE_OPTIONS_FIELD,
  type RubricGrade,
} from "@/lib/grade-input";
import { RUBRIC_GRADE_LABELS } from "@/lib/rfp-labels";
import {
  loadedKey,
  META_FIELDS,
  RUBRIC_METRICS,
  type FormField,
} from "@/lib/rfp-rubric";

const initialState: SaveState = {};

const GRADE_TONE: Record<RubricGrade, string> = {
  best: "peer-checked:border-moss peer-checked:bg-moss/12",
  good: "peer-checked:border-moss/70 peer-checked:bg-moss/8",
  meh: "peer-checked:border-tan peer-checked:bg-tan/15",
  bad: "peer-checked:border-salmon peer-checked:bg-salmon/12",
  unclear: "peer-checked:border-ink/40 peer-checked:bg-ink/6",
};
const RUBRIC_GRADES = Object.keys(GRADE_TONE) as RubricGrade[];

/** Where a finished grader moves it, offered while it's still in grading. */
const ADVANCE_TO = "2. Committee decision";

const inputClass =
  "w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] outline-none focus:border-navy";

function asString(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

function asArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-xl border border-line bg-white p-5">
      <h2 className="font-bebas text-xl tracking-wide text-navy">{title}</h2>
      {children}
    </section>
  );
}

function Field({
  field,
  initial,
  loaded = false,
}: {
  field: FormField;
  initial: Record<string, unknown>;
  /** Also post the loaded value, for fields shared with other graders. */
  loaded?: boolean;
}) {
  return (
    <div>
      <div className="font-medium text-navy">
        <label htmlFor={field.key}>{field.label}</label>
        {field.description && <InfoTip text={field.description} />}
      </div>

      {field.kind === "text" && (
        <textarea
          id={field.key}
          name={field.key}
          rows={3}
          defaultValue={asString(initial[field.key])}
          className={`${inputClass} mt-1`}
        />
      )}
      {field.kind === "text" && loaded && (
        <input
          type="hidden"
          name={loadedKey(field.key)}
          value={asString(initial[field.key])}
        />
      )}

      {field.kind === "checkbox" && (
        <label className="mt-1.5 flex w-fit cursor-pointer items-center gap-2 text-[15px] text-ink/80">
          <input
            id={field.key}
            type="checkbox"
            name={field.key}
            value="true"
            defaultChecked={initial[field.key] === true}
            className="h-4 w-4 accent-navy"
          />
          Yes
        </label>
      )}
      {field.kind === "checkbox" && (
        // The save reads the box as ticked when any "true" was posted, so this
        // only says "unticked" when the box itself sent nothing.
        <input type="hidden" name={field.key} value="false" />
      )}
      {field.kind === "checkbox" && loaded && (
        <input
          type="hidden"
          name={loadedKey(field.key)}
          value={initial[field.key] === true ? "true" : "false"}
        />
      )}

      {field.kind === "number" && (
        <input
          id={field.key}
          name={field.key}
          type="number"
          min={0}
          defaultValue={asString(initial[field.key])}
          className={`${inputClass} mt-1 max-w-40`}
        />
      )}

      {field.kind === "select" && (
        <select
          id={field.key}
          name={field.key}
          defaultValue={asString(initial[field.key])}
          className={`${inputClass} mt-1`}
        >
          <option value="">—</option>
          {Object.entries(field.options).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      )}

      {field.kind === "multiSelect" && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {/* Keeps the field in the payload when nothing is ticked, so
              unticking everything clears it. */}
          <input type="hidden" name={field.key} value="" />
          {Object.entries(field.options).map(([value, label]) => (
            <label key={value} className="cursor-pointer">
              <input
                type="checkbox"
                name={field.key}
                value={value}
                defaultChecked={asArray(initial[field.key]).includes(value)}
                className="peer sr-only"
              />
              <span className="inline-block rounded-full border border-line px-3 py-1.5 text-sm transition-colors peer-checked:border-navy peer-checked:bg-navy peer-checked:text-cream hover:bg-cream">
                {label}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default function GradeForm({
  sessionId,
  initial,
  spaceOptions,
  notes,
  notesFields,
  shepherdContact,
  phase,
}: {
  sessionId: string;
  /** The viewer's own grade, keyed as the form names its fields. */
  initial: Record<string, unknown>;
  /** Location id → label for the rooms a grade may suggest. */
  spaceOptions: Record<string, string>;
  /** The session's shepherd notes. */
  notes: Record<string, unknown>;
  notesFields: readonly FormField[];
  /** Rendered server-side above the notes: tier pills and host contact. */
  shepherdContact?: React.ReactNode;
  phase: string | null;
}) {
  const [state, action, pending] = useActionState(
    retryable(keepingSavedAt(submitGrades.bind(null, sessionId))),
    initialState,
  );

  // The prompt tracks the rubric until the grader overrides it by hand: saving
  // with all five scored is a finished grade, saving partway through isn't.
  const [complete, setComplete] = useState(() =>
    RUBRIC_METRICS.every((m) => Boolean(initial[m.key])),
  );
  const [override, setOverride] = useState<boolean | null>(null);

  // Only offered while it's still sitting in grading — past that, moving it
  // back to the committee's queue would walk the pipeline backwards.
  const advance = phase === null || phase === "grading";

  const metaFields = META_FIELDS.map((f) =>
    f.key === SPACE_OPTIONS_FIELD && f.kind === "multiSelect"
      ? { ...f, options: spaceOptions }
      : f,
  );

  return (
    // React resets an uncontrolled form once its action resolves, which snapped
    // every field back to the defaults captured before the save. Re-keying on
    // the save remounts the form against `initial` as it's now stored.
    <form
      key={state.savedAt ?? "initial"}
      action={action}
      onSubmit={submitKeepingDraft(action)}
      onChange={(event) => {
        const data = new FormData(event.currentTarget);
        setComplete(RUBRIC_METRICS.every((m) => data.get(m.key)));
      }}
      className="space-y-6"
    >
      <Section title="Rubric">
        <div className="space-y-6">
          {RUBRIC_METRICS.map((metric) => {
            const current = asString(initial[metric.key]);
            return (
              <fieldset key={metric.key}>
                <legend className="mb-2 font-medium text-navy">
                  {metric.label}
                </legend>
                <div className="grid gap-1.5">
                  {RUBRIC_GRADES.map((grade) => (
                    <label
                      key={grade}
                      className="flex cursor-pointer items-start gap-3"
                    >
                      <input
                        type="radio"
                        name={metric.key}
                        value={grade}
                        defaultChecked={current === grade}
                        className="peer sr-only"
                      />
                      <span
                        className={`flex-1 rounded-lg border border-line px-3 py-2 text-sm transition-colors hover:bg-cream ${GRADE_TONE[grade]}`}
                      >
                        <span className="font-semibold text-navy">
                          {RUBRIC_GRADE_LABELS[grade]}
                        </span>
                        <span className="ml-2 text-ink/65">
                          {metric.guidance[grade] ??
                            "No strong read either way."}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          })}
        </div>
      </Section>

      <Section title="Details">
        <div className="space-y-5">
          {metaFields.map((field) => (
            <Field key={field.key} field={field} initial={initial} />
          ))}
        </div>
      </Section>

      <Section title="Shepherd notes">
        {shepherdContact}
        <div className="space-y-5">
          {notesFields.map((field) => (
            <Field key={field.key} field={field} initial={notes} loaded />
          ))}
        </div>
      </Section>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-line bg-cream/95 px-4 py-3 backdrop-blur">
        {advance && (
          // Unchecked boxes are left out of the form data entirely, so not
          // ticking this leaves the phase alone.
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink/70">
            <input
              type="checkbox"
              name={ADVANCE_FIELD}
              value="1"
              checked={override ?? complete}
              onChange={(event) => setOverride(event.target.checked)}
              className="size-4 accent-meeple"
            />
            Done grading — move to “{ADVANCE_TO}”
          </label>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-meeple px-5 py-2.5 font-roboto font-semibold text-white transition-colors hover:bg-meeple-dark disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <p aria-live="polite" className="text-sm">
          {state.error ? (
            <span className="text-meeple">{state.error}</span>
          ) : state.savedAt ? (
            <span className="text-moss">Saved.</span>
          ) : null}
        </p>
      </div>
    </form>
  );
}
