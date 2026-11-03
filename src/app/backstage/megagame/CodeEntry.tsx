"use client";

import { useId, useRef, useState } from "react";
import {
  TICKET_CODE_LENGTH,
  normalizeTicketCode,
} from "@/lib/ticket-code-format";
import PinInput from "@/v2/components/auth/PinInput";

/** A six-character code in boxes; submits itself when the last box fills. */
export default function CodeEntry({
  label,
  onCode,
  disabled,
  autoFocus = false,
}: {
  label: string;
  /** Resolve true to clear the boxes for the next code. */
  onCode: (code: string) => Promise<boolean> | boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [round, setRound] = useState(0);
  const id = useId();

  return (
    <form
      ref={form}
      onSubmit={async (e) => {
        e.preventDefault();
        const code = normalizeTicketCode(
          String(new FormData(e.currentTarget).get("code") ?? ""),
        );
        if (code.length !== TICKET_CODE_LENGTH) return;
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
        length={TICKET_CODE_LENGTH}
        alphanumeric
        normalize={normalizeTicketCode}
        autoFocus={autoFocus}
        disabled={disabled}
        onComplete={() => setTimeout(() => form.current?.requestSubmit(), 0)}
      />
    </form>
  );
}
