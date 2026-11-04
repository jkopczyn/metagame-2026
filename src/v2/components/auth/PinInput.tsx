"use client";

import { Fragment, useRef, useState } from "react";
import { cn } from "@/v2/lib/utils";
import { fillCells, typedChars } from "./pin-cells";

const digitsOnly = (text: string) => text.replace(/\D/g, "");

// One box per character; the hidden input carries the joined value for the form.
// The first box takes the OS one-time-code autofill (a whole string at once),
// and paste anywhere spreads the characters across the boxes.
export default function PinInput({
  name,
  id,
  length = 6,
  disabled,
  autoFocus = true,
  normalize = digitsOnly,
  alphanumeric = false,
  dashAfter,
  onComplete,
}: {
  name: string;
  /** Put on the first box so a `<label htmlFor>` lands there. */
  id?: string;
  length?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Maps raw typed/pasted text to the accepted characters. */
  normalize?: (text: string) => string;
  alphanumeric?: boolean;
  /** Draws a dash after this many boxes. */
  dashAfter?: number;
  onComplete?: () => void;
}) {
  const [cells, setCells] = useState<string[]>(() =>
    Array.from({ length }, () => ""),
  );
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const noun = alphanumeric ? "Character" : "Digit";

  const focus = (i: number) =>
    refs.current[Math.max(0, Math.min(length - 1, i))]?.focus();

  const fill = (from: number, text: string) => {
    const incoming = normalize(text);
    if (!incoming) return;
    const { cells: next, focus: last } = fillCells(cells, from, incoming);
    setCells(next);
    focus(last);
    if (next.every(Boolean)) onComplete?.();
  };

  return (
    <div className="flex w-full items-center gap-1.5 sm:gap-2">
      {cells.map((cell, i) => (
        <Fragment key={i}>
          <input
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={i === 0 ? id : undefined}
            value={cell}
            inputMode={alphanumeric ? "text" : "numeric"}
            pattern={alphanumeric ? undefined : "[0-9]*"}
            autoCapitalize={alphanumeric ? "characters" : undefined}
            autoCorrect="off"
            spellCheck={false}
            autoComplete={i === 0 ? "one-time-code" : "off"}
            autoFocus={autoFocus && i === 0}
            disabled={disabled}
            aria-label={`${noun} ${i + 1} of ${length}`}
            onChange={(e) => {
              const text = e.target.value;
              if (!text) {
                const next = [...cells];
                next[i] = "";
                setCells(next);
                return;
              }
              fill(i, typedChars(cell, text));
            }}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !cell && i > 0) {
                e.preventDefault();
                const next = [...cells];
                next[i - 1] = "";
                setCells(next);
                focus(i - 1);
              } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                focus(i - 1);
              } else if (e.key === "ArrowRight") {
                e.preventDefault();
                focus(i + 1);
              }
            }}
            onPaste={(e) => {
              e.preventDefault();
              fill(i, e.clipboardData.getData("text"));
            }}
            onFocus={(e) => e.target.select()}
            className={cn(
              "aspect-square max-w-12 min-w-0 flex-1 rounded-lg border-[1.5px] border-navy/20 bg-white text-center font-space-mono text-2xl text-ink uppercase transition-colors outline-none focus:border-meeple disabled:opacity-60 sm:max-w-14 sm:min-w-14",
            )}
          />
          {dashAfter === i + 1 && (
            // A drawn bar, not a glyph: the font's dash sits below centre.
            <span
              aria-hidden
              className="h-0.5 w-2 shrink-0 rounded-full bg-current opacity-40 sm:w-3"
            />
          )}
        </Fragment>
      ))}
      <input type="hidden" name={name} value={cells.join("")} />
    </div>
  );
}
