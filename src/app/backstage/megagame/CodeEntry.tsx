"use client";

import { useId, useRef, useState } from "react";
import {
  TICKET_CODE_LENGTH,
  normalizeTicketCode,
} from "@/lib/ticket-code-format";
import PinInput from "@/v2/components/auth/PinInput";

const digitsOnly = (text: string) => text.replace(/\D/g, "");

/**
 * A code in boxes that submits itself when the last box fills: a six-character
 * quest code by default, or a four-digit badge number with `badge`.
 */
export default function CodeEntry({
  label,
  onCode,
  disabled,
  autoFocus = false,
  badge = false,
}: {
  label: string;
  badge?: boolean;
  /** Resolve true to clear the boxes for the next code. */
  onCode: (code: string) => Promise<boolean> | boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [round, setRound] = useState(0);
  const id = useId();
  const length = badge ? 4 : TICKET_CODE_LENGTH;
  const normalize = badge ? digitsOnly : normalizeTicketCode;

  return (
    <form
      ref={form}
      onSubmit={async (e) => {
        e.preventDefault();
        const code = normalize(
          String(new FormData(e.currentTarget).get("code") ?? ""),
        );
        if (code.length !== length) return;
        if (await onCode(code)) setRound((r) => r + 1);
      }}
      className="flex flex-col gap-2"
    >
      <label htmlFor={id} className="text-sm font-medium text-ink/80">
        {label}
      </label>
      <PinInput
        key={round}
        name="code"
        id={id}
        length={length}
        alphanumeric={!badge}
        normalize={normalize}
        autoFocus={autoFocus}
        disabled={disabled}
        onComplete={() => setTimeout(() => form.current?.requestSubmit(), 0)}
      />
    </form>
  );
}
