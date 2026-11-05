"use client";

import { useState } from "react";
import { fieldClass, smallButtonClass } from "../ui";
import { logAnswerAttempt } from "./actions";
import { attemptLog } from "./attempt-log";
import { matchAnswer } from "@/lib/megagame-rules";

/**
 * A helper only: the volunteer decides. Answers stay hidden until revealed.
 * What was typed is logged when the volunteer presses Enter or leaves the
 * field, not on each keystroke. Leaving the field includes tapping "Reveal
 * answers" or switching apps, so an unfinished answer can be logged then.
 */
export default function AnswerChecker({
  questCode,
  answers,
  players,
}: {
  questCode: string;
  answers: string[];
  /** The listed players, whose attempt counts the log updates. */
  players: string[];
}) {
  const [entered, setEntered] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [log] = useState(attemptLog);
  const match = matchAnswer(entered, answers);

  const record = () => {
    if (log.take(entered)) {
      // A failed log must not get in the volunteer's way.
      logAnswerAttempt(questCode, entered, players).catch(() => {});
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor="answer" className="text-sm font-medium text-ink/80">
        What did the players say?
      </label>
      <input
        id="answer"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        value={entered}
        onChange={(e) => setEntered(e.target.value)}
        onBlur={record}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            record();
          }
        }}
        enterKeyHint="done"
        className={fieldClass}
      />
      {entered.trim() !== "" && (
        <p
          aria-live="polite"
          className={`rounded-lg px-3 py-2 font-semibold ${
            match.matched
              ? "bg-green-100 text-green-900"
              : "bg-amber-100 text-amber-900"
          }`}
        >
          {match.matched ? `Match: ${match.answer}` : "No match"}
        </p>
      )}
      {revealed ? (
        <div className="text-sm">
          <p className="font-medium text-ink/80">Accepted answers</p>
          {answers.length === 0 ? (
            <p className="text-ink/60">None listed.</p>
          ) : (
            <ul className="list-disc pl-5 text-ink">
              {answers.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => setRevealed(false)}
            className={`${smallButtonClass} mt-2`}
          >
            Hide answers
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className={`${smallButtonClass} self-start`}
        >
          Reveal answers
        </button>
      )}
    </div>
  );
}
