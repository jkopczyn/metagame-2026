"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CircleAlert, RotateCcw } from "lucide-react";
import { readUtm } from "@/lib/utm";
import { FORMS } from "@/v2/forms";
import {
  answerWords,
  boxWords,
  checkForm,
  checkStep,
  isEmpty,
  isQuestion,
  optionBoxes,
  prefillAnswers,
  sameAnswer,
  sameAnswers,
  visibleItems,
  visibleSteps,
  type Answer,
  type Answers,
  type Item,
  type Note,
  type Prefill,
  type Step,
} from "@/v2/forms/engine";
import { TEAM_EMAIL } from "@/v2/lib/links";
import { cn } from "@/v2/lib/utils";
import Mg2Die from "../nav/Mg2Die";
import { Button } from "../ui/button";
import { Field } from "./Fields";
import { DISPLAY } from "./look";
import Rich from "./Rich";
import ScheduleBoard, { SCHEDULE_KEYS } from "./ScheduleBoard";
import TeamBoard, { TEAM_KEYS } from "./TeamBoard";
import Track from "./Track";

type Phase =
  | { at: "step"; index: number }
  | { at: "done"; preview?: Record<string, unknown> };

const draftKey = (slug: string) => `journey:${slug}`;

// The questions a step's board asks itself, so they aren't asked twice.
const BOARD_KEYS: Record<NonNullable<Step["view"]>, readonly string[]> = {
  schedule: SCHEDULE_KEYS,
  teams: TEAM_KEYS,
};
const onBoard = (step: Step, key: string) =>
  !!step.view && BOARD_KEYS[step.view].includes(key);

// Questions that share a row sit side by side; the rest take the width.
function rows(items: Item[]) {
  const out: Item[][] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    const row = isQuestion(item) ? item.row : undefined;
    if (row && last && isQuestion(last[0]) && last[0].row === row)
      last.push(item);
    else out.push([item]);
  }
  return out;
}

const EYEBROW =
  "font-space-mono text-[11px] font-bold tracking-[0.14em] text-ink/55 uppercase";
const HEADING = `${DISPLAY} text-[clamp(36px,5vw,56px)] leading-[0.95] text-navy outline-none`;

// The tokens that pile up when you finish, in the brand's colours.
const CONFETTI = [
  "bg-meeple",
  "bg-tan",
  "bg-sky",
  "bg-moss",
  "bg-brand-blue",
  "bg-peach",
  "bg-navy",
];

// One of the site's forms as a journey (src/v2/forms): the first step under
// a short introduction, then a step at a time along a board of spaces; the
// last step's button sends it in, and the confirmation shows every answer.
// Answers are kept in this browser as you go (pictures aside), so a refresh
// picks up where you left off. The finished answers go to /api/forms/<slug>,
// which writes them to the Airtable table the old form did.
export default function Journey({
  slug,
  prefill,
}: {
  slug: string;
  /** What the signed-in account knows; fills the questions that ask for it. */
  prefill?: Prefill;
}) {
  const def = FORMS[slug];
  // The account's details, in place before anyone types. They win over a
  // saved draft, which may be someone else's from this browser.
  const filled = useMemo(() => prefillAnswers(def, prefill), [def, prefill]);
  const [answers, setAnswers] = useState<Answers>(filled);
  const [phase, setPhase] = useState<Phase>({ at: "step", index: 0 });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [back, setBack] = useState(false);
  const [sending, setSending] = useState(false);
  const top = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const honeypot = useRef<HTMLInputElement>(null);

  const steps = visibleSteps(def, answers);
  const index =
    phase.at === "step" ? Math.min(phase.index, steps.length - 1) : -1;
  const step = index >= 0 ? steps[index] : undefined;
  const last = index === steps.length - 1;

  // A saved draft, read once mounted (the timer keeps setState out of the
  // effect body).
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const saved = JSON.parse(
          localStorage.getItem(draftKey(slug)) ?? "null",
        );
        if (saved?.answers && Object.keys(saved.answers).length) {
          setAnswers({ ...saved.answers, ...filled });
          setPhase({
            at: "step",
            index: typeof saved.step === "number" ? saved.step : 0,
          });
        }
      } catch {}
    }, 0);
    return () => clearTimeout(t);
  }, [slug, filled]);

  // Keep the draft as they go. Pictures are too big for storage, and the
  // account's own details stay out so they aren't left for the next visitor.
  const stepIndex = phase.at === "step" ? phase.index : null;
  useEffect(() => {
    if (phase.at === "done" || !Object.keys(answers).length) return;
    const t = setTimeout(() => {
      try {
        const kept = Object.fromEntries(
          Object.entries(answers).filter(
            ([k, v]) =>
              !(v && typeof v === "object" && !Array.isArray(v)) &&
              !sameAnswer(v, filled[k]),
          ),
        );
        if (!Object.keys(kept).length) localStorage.removeItem(draftKey(slug));
        else
          localStorage.setItem(
            draftKey(slug),
            JSON.stringify({ answers: kept, step: stepIndex ?? 0 }),
          );
      } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [answers, filled, phase.at, stepIndex, slug]);

  const go = (next: Phase, keep: Record<string, string> = {}) => {
    const order = (p: Phase) => (p.at === "step" ? p.index : 999);
    setBack(order(next) < order(phase));
    setPhase(next);
    setErrors(keep);
    requestAnimationFrame(() => {
      top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      heading.current?.focus({ preventScroll: true });
    });
  };

  const set = (key: string, v: Answer) => {
    setAnswers((a) => ({ ...a, [key]: v }));
    setErrors((e) => {
      if (!e[key]) return e;
      const rest = { ...e };
      delete rest[key];
      return rest;
    });
  };
  // For the boards, which can change several answers in one drag.
  const update = (key: string, fn: (v: Answer) => Answer) =>
    setAnswers((a) => ({ ...a, [key]: fn(a[key]) }));

  const focusFirst = (e: Record<string, string>) =>
    requestAnimationFrame(() => {
      const key = Object.keys(e)[0];
      document
        .querySelector<HTMLElement>(
          `[data-field="${key}"] input, [data-field="${key}"] textarea`,
        )
        ?.focus();
    });

  // Next, or on the last step, send.
  const forward = () => {
    if (!step) return;
    const e = checkStep(step, answers);
    if (Object.keys(e).length) {
      setErrors(e);
      focusFirst(e);
      return;
    }
    if (last) void submit();
    else go({ at: "step", index: index + 1 });
  };

  const backward = () => {
    if (step && index > 0) go({ at: "step", index: index - 1 });
  };

  // Back to the first step with a problem, showing what's wrong.
  const showProblems = (e: Record<string, string>) => {
    const i = steps.findIndex((s) =>
      visibleItems(s, answers).some(
        (it) =>
          isQuestion(it) &&
          (e[it.key] || optionBoxes(it, answers).some((b) => e[b.key])),
      ),
    );
    go({ at: "step", index: Math.max(0, i) }, e);
    focusFirst(e);
  };

  const submit = async () => {
    const e = checkForm(def, answers);
    if (Object.keys(e).length) return showProblems(e);
    setFailure(null);
    setSending(true);
    try {
      const res = await fetch(`/api/forms/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers,
          utm: readUtm(),
          website: honeypot.current?.value ?? "",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.errors && Object.keys(data.errors).length)
          return showProblems(data.errors);
        setFailure(data.error ?? "Something went wrong on our end.");
        return;
      }
      try {
        localStorage.removeItem(draftKey(slug));
      } catch {}
      go({
        at: "done",
        preview: data.stored === false ? data.preview : undefined,
      });
    } catch {
      setFailure(
        "Couldn't reach the site. Check your connection and try again.",
      );
    } finally {
      setSending(false);
    }
  };

  const startOver = () => {
    try {
      localStorage.removeItem(draftKey(slug));
    } catch {}
    setAnswers(filled);
    go({ at: "step", index: 0 });
  };

  // Partway through: past the first step, or anything answered beyond what
  // the account filled in.
  const edited = useMemo(
    () => !sameAnswers(answers, filled),
    [answers, filled],
  );
  const underway = phase.at === "step" && (index > 0 || edited);
  const view = phase.at === "step" ? `step-${step?.key}` : phase.at;

  return (
    <div
      ref={top}
      className="mx-auto w-full max-w-[880px] scroll-mt-6 px-4 pt-24 pb-20 sm:px-8 md:pt-28"
    >
      <header>
        <p className={EYEBROW}>{def.eyebrow}</p>
        <h1
          className={`${DISPLAY} mt-2 text-[clamp(42px,6.5vw,76px)] leading-[0.9] text-balance text-navy`}
        >
          {def.title}
        </h1>
      </header>

      {index === 0 && (
        <div className="mt-6">
          <p className="max-w-[38em] text-lg leading-relaxed whitespace-pre-line text-ink/80 sm:text-xl">
            <Rich text={def.pitch} />
          </p>
          {def.aside && (
            <p className="mt-3 text-[15.5px] font-semibold text-navy">
              {def.aside}
            </p>
          )}
          {def.facts?.length ? (
            <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-4 border-y-2 border-navy py-4">
              {def.facts.map(({ label, value }) => (
                <div key={label}>
                  <dt className="font-space-mono text-[10.5px] font-bold tracking-[0.14em] text-meeple uppercase">
                    {label}
                  </dt>
                  <dd
                    className={`${DISPLAY} mt-1 text-[26px] leading-none text-navy`}
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {def.warning && (
            <p className="mt-5 flex max-w-[44em] items-start gap-2.5 border-l-2 border-meeple pl-4 text-[15px] leading-relaxed text-ink/80">
              <CircleAlert
                aria-label="Warning"
                className="mt-[3px] size-[18px] shrink-0 text-meeple"
                strokeWidth={2.5}
              />
              <span>
                <Rich text={def.warning} />
              </span>
            </p>
          )}
          {def.notice && (
            <p className="mt-5 max-w-[44em] border-l-2 border-tan pl-4 text-[15px] leading-relaxed text-ink/70">
              <Rich text={def.notice} contactSubject={def.name} />
            </p>
          )}
        </div>
      )}

      {phase.at !== "done" && steps.length > 1 && (
        <Track
          titles={steps.map((s) => s.title)}
          current={index}
          onJump={(i) => go({ at: "step", index: i })}
        />
      )}
      {underway && (
        <p className="mt-3 text-right text-[14px] text-ink/55">
          <button
            type="button"
            onClick={startOver}
            disabled={sending}
            className="inline-flex items-center gap-1 font-semibold underline underline-offset-2 hover:text-meeple disabled:opacity-40"
          >
            <RotateCcw aria-hidden className="size-3" />
            Start over
          </button>
        </p>
      )}

      <div
        key={view}
        className={cn(
          "mt-9 animate-in duration-300 fade-in",
          back ? "slide-in-from-left-4" : "slide-in-from-right-4",
        )}
      >
        {step && (
          <section aria-labelledby="journey-heading">
            <h2
              id="journey-heading"
              ref={heading}
              tabIndex={-1}
              className={HEADING}
            >
              {step.title}
            </h2>
            {step.intro && (
              <p className="mt-2 max-w-[40em] text-[16.5px] leading-relaxed text-ink/75">
                <Rich text={step.intro} />
              </p>
            )}
            <div className="mt-8 flex flex-col gap-9">
              {step.view === "schedule" && (
                <ScheduleBoard answers={answers} update={update} />
              )}
              {step.view === "teams" && (
                <TeamBoard answers={answers} update={update} />
              )}
              {rows(
                visibleItems(step, answers).filter(
                  (item) => !onBoard(step, item.key),
                ),
              ).map((row) => {
                const fields = row.map((item) =>
                  isQuestion(item) ? (
                    <Field
                      key={item.key}
                      q={item}
                      value={answers[item.key]}
                      error={errors[item.key]}
                      boxErrors={errors}
                      onChange={(v) => set(item.key, v)}
                      onEnter={forward}
                      answers={answers}
                      onExtra={set}
                    />
                  ) : (
                    <NoteBlock key={item.key} note={item} />
                  ),
                );
                return isQuestion(row[0]) && row[0].row ? (
                  <div
                    key={row[0].key}
                    className="grid gap-x-6 gap-y-9 sm:grid-cols-2"
                  >
                    {fields}
                  </div>
                ) : (
                  <Fragment key={row[0].key}>{fields}</Fragment>
                );
              })}
            </div>
            {failure && (
              <p
                role="alert"
                className="mt-8 border-l-2 border-meeple pl-4 text-[15.5px] text-ink/80"
              >
                <b className="text-meeple">That didn&apos;t go through.</b>{" "}
                {failure} If it keeps happening, email{" "}
                <a
                  href={`mailto:${TEAM_EMAIL}`}
                  className="font-semibold text-navy underline underline-offset-2"
                >
                  {TEAM_EMAIL}
                </a>
                .
              </p>
            )}
            <Footer
              onBack={index ? backward : undefined}
              disabled={sending}
              next={
                last ? (
                  <Button
                    onClick={forward}
                    size="lg"
                    disabled={sending}
                    className="gap-3"
                  >
                    <Mg2Die
                      size={22}
                      className={sending ? "motion-safe:animate-spin" : ""}
                    />
                    {sending ? "Submitting…" : "Submit"}
                  </Button>
                ) : (
                  <Button onClick={forward} size="lg" className="gap-2">
                    Next
                    <ArrowRight aria-hidden className="size-4" />
                  </Button>
                )
              }
              hint={
                Object.keys(errors).length
                  ? "A few answers need another look."
                  : undefined
              }
            />
          </section>
        )}

        {phase.at === "done" && (
          <section aria-labelledby="journey-heading">
            <div aria-hidden className="flex flex-wrap gap-1.5">
              {Array.from({ length: 14 }, (_, i) => (
                <span
                  key={i}
                  className={cn(
                    "size-5 rounded-full motion-safe:animate-in motion-safe:duration-500 motion-safe:fill-mode-backwards motion-safe:zoom-in-50 motion-safe:fade-in motion-safe:slide-in-from-top-3",
                    CONFETTI[i % CONFETTI.length],
                  )}
                  style={{ animationDelay: `${i * 55}ms` }}
                />
              ))}
            </div>
            <p className={`${EYEBROW} mt-7`}>Sent</p>
            <h2
              id="journey-heading"
              ref={heading}
              tabIndex={-1}
              className={`${DISPLAY} mt-1 text-[clamp(44px,6.5vw,76px)] leading-[0.9] text-navy outline-none`}
            >
              {def.done.title}
            </h2>
            <p className="mt-4 max-w-[38em] text-lg leading-relaxed text-ink/80">
              {def.done.body}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {def.done.links.map(({ label, href }, i) => (
                <Button
                  key={href}
                  asChild
                  variant={i ? "ghost" : "default"}
                  className={
                    i
                      ? "border-2 border-navy text-navy hover:border-navy hover:bg-navy/5"
                      : ""
                  }
                >
                  {href.startsWith("/") ? (
                    <Link href={href}>{label}</Link>
                  ) : (
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      {label}
                    </a>
                  )}
                </Button>
              ))}
            </div>
            <h3
              className={`${DISPLAY} mt-14 text-[30px] leading-none text-navy`}
            >
              Your answers
            </h3>
            {steps.map((s) => {
              const said = visibleItems(s, answers)
                .filter(isQuestion)
                .filter((q) => !isEmpty(answers[q.key]));
              return (
                <div key={s.key} className="mt-6 border-t-2 border-navy pt-3">
                  <h4
                    className={`${DISPLAY} text-[24px] leading-none text-navy`}
                  >
                    {s.title}
                  </h4>
                  {said.length ? (
                    <dl className="mt-3 grid gap-x-6 gap-y-2.5 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
                      {said.map((q) => (
                        <div key={q.key} className="contents">
                          <dt className="text-[15px] leading-snug text-ink/60">
                            {q.label}
                          </dt>
                          <dd className="text-[16px] leading-snug font-medium break-words whitespace-pre-wrap text-navy">
                            {[
                              answerWords(q, answers[q.key]),
                              boxWords(q, answers),
                            ]
                              .filter(Boolean)
                              .join("\n")}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="mt-2 text-[15px] text-ink/45 italic">
                      Skipped.
                    </p>
                  )}
                </div>
              );
            })}
            {phase.preview && (
              <div className="mt-10 border-t border-navy/15 pt-4">
                <p className="font-space-mono text-[11px] font-bold tracking-[0.12em] text-ink/55 uppercase">
                  Dev only: not saved (no AIRTABLE_API_KEY). This row would go
                  to {def.tableId}:
                </p>
                <pre className="mt-2 overflow-x-auto text-[12px] leading-relaxed text-ink/70">
                  {JSON.stringify(phase.preview, null, 2)}
                </pre>
              </div>
            )}
          </section>
        )}
      </div>

      {/* Bots fill in every field; people never see this one. */}
      <input
        ref={honeypot}
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        className="absolute -left-[9999px] size-px opacity-0"
      />
    </div>
  );
}

function Footer({
  onBack,
  next,
  hint,
  disabled,
}: {
  onBack?: () => void;
  next: React.ReactNode;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t-2 border-navy pt-5">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-navy hover:text-meeple disabled:opacity-40"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Back
        </button>
      ) : (
        <span />
      )}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-4">
        {hint && (
          <p role="alert" className="text-sm font-semibold text-meeple">
            {hint}
          </p>
        )}
        {next}
      </div>
    </div>
  );
}

function NoteBlock({ note }: { note: Note }) {
  const win = note.tone === "win";
  return (
    <div
      role={win ? "status" : undefined}
      className={cn(
        "animate-in border-l-4 py-1 pl-5 duration-500 fade-in slide-in-from-left-2",
        win ? "border-moss" : "border-tan",
      )}
    >
      {note.title && (
        <p
          className={`${DISPLAY} text-[30px] leading-none ${win ? "text-moss" : "text-navy"}`}
        >
          {note.title}
        </p>
      )}
      <p className="mt-2 max-w-[42em] text-[15.5px] leading-relaxed text-ink/80">
        <Rich text={note.body} />
      </p>
      {note.cta && (
        <Button asChild className="mt-4">
          <a href={note.cta.href}>{note.cta.label} →</a>
        </Button>
      )}
    </div>
  );
}
