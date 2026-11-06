"use client";

import { useState } from "react";
import { fieldClass, smallButtonClass } from "../ui";
import { matchAnswer } from "@/lib/megagame-rules";

/** A helper only: the volunteer decides. Answers stay hidden until revealed. */
export default function AnswerChecker({ answers }: { answers: string[] }) {
  const [entered, setEntered] = useState("");
  const [revealed, setRevealed] = useState(false);
  const match = matchAnswer(entered, answers);

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
