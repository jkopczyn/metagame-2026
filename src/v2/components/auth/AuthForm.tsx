"use client";

import { useActionState, useRef, useState } from "react";
import PinInput from "./PinInput";
import { authenticate, type AuthState } from "@/app/(v2)/login/actions";
import { retryable } from "@/lib/action-retry";
import { Button } from "@/v2/components/ui/button";
import { Input } from "@/v2/components/ui/input";
import { FIELD_LIGHT } from "@/v2/components/styles";

const initial: AuthState = { step: "email", email: "" };

const submit = retryable(authenticate, (data: FormData) => ({
  email: String(data.get("email") ?? ""),
}));

const LINK =
  "text-sm font-semibold text-meeple underline-offset-2 hover:underline";
const FORM = "flex max-w-[420px] flex-col gap-4";

function Messages({ state }: { state: AuthState }) {
  return (
    <p aria-live="polite" className="min-h-5 text-sm">
      {state.error ? (
        <span className="text-meeple">{state.error}</span>
      ) : (
        <span className="text-ink/70">{state.notice}</span>
      )}
    </p>
  );
}

/**
 * A link-styled submit that fires one of the action's intents. None of them
 * need the step's fields, so they skip the browser's required-field check
 * (otherwise "Use a different email" would demand a password first).
 */
function IntentButton({
  intent,
  disabled,
  children,
}: {
  intent: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      name="intent"
      value={intent}
      formNoValidate
      disabled={disabled}
      className={LINK}
    >
      {children}
    </button>
  );
}

// Email first; the next step depends on what that address has. See the
// state chart in login/actions.ts.
export default function AuthForm({ next }: { next: string }) {
  const [result, action, pending] = useActionState(submit, initial);
  // "Use a different email" is just going back, so it's done here rather
  // than by a round trip: remember which result was backed out of, and show
  // the email step until the next result replaces it.
  const [backedOut, setBackedOut] = useState<AuthState | null>(null);
  const state: AuthState =
    backedOut === result ? { step: "email", email: result.email } : result;
  const verifyButton = useRef<HTMLButtonElement>(null);
  // Every result empties the code boxes: left full, each correction would
  // auto-submit and use up the code's attempts.
  const [pin, setPin] = useState({ result, key: 0 });
  if (pin.result !== result) setPin({ result, key: pin.key + 1 });

  const hidden = <input type="hidden" name="next" value={next} />;
  // Past the first step the address is settled; it rides along hidden, with
  // "Use a different email" the way to change it. Rendered as a real (if
  // hidden) email field where there's a password, so password managers file
  // it under the right account.
  const fixedEmail = (
    <input
      type="email"
      name="email"
      value={state.email}
      autoComplete="username"
      readOnly
      hidden
    />
  );
  const differentEmail = (
    <button
      type="button"
      disabled={pending}
      onClick={() => setBackedOut(result)}
      className={LINK}
    >
      Use a different email
    </button>
  );

  if (state.step === "password") {
    return (
      <form action={action} className={FORM}>
        {hidden}
        {fixedEmail}
        <p className="text-base text-ink">
          Welcome back. Enter the password for <strong>{state.email}</strong>.
        </p>
        <Input
          type="password"
          name="password"
          autoComplete="current-password"
          placeholder="Password"
          required
          autoFocus
          className={FIELD_LIGHT}
        />
        <Button
          type="submit"
          name="intent"
          value="password"
          disabled={pending}
          className="self-start"
        >
          {pending ? "One sec…" : "Sign in"}
        </Button>
        <Messages state={state} />
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <IntentButton intent="code" disabled={pending}>
            Forgot it? Email me a code
          </IntentButton>
          {differentEmail}
        </div>
      </form>
    );
  }

  if (state.step === "new") {
    return (
      <form action={action} className={FORM}>
        {hidden}
        {fixedEmail}
        <p className="text-base text-ink">
          There&apos;s no account under <strong>{state.email}</strong> yet. Want
          one? We&apos;ll email you a six-digit code to confirm the address, and
          that&apos;s the whole sign-up.
        </p>
        <Button
          type="submit"
          name="intent"
          value="code"
          disabled={pending}
          className="self-start"
        >
          {pending ? "One sec…" : "Create my account"}
        </Button>
        <Messages state={state} />
        {differentEmail}
      </form>
    );
  }

  if (state.step === "code") {
    return (
      <form action={action} className={FORM}>
        {hidden}
        {fixedEmail}
        <p className="text-base text-ink">
          We emailed a six-digit code to <strong>{state.email}</strong>. Enter
          it below; it works for 10 minutes. Not there? Check spam, or send a
          new one.
        </p>
        <PinInput
          key={pin.key}
          name="code"
          disabled={pending}
          onComplete={() => verifyButton.current?.click()}
        />
        <Button
          ref={verifyButton}
          type="submit"
          name="intent"
          value="verify"
          disabled={pending}
          className="self-start"
        >
          {pending ? "Checking…" : "Continue"}
        </Button>
        <Messages state={state} />
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <IntentButton intent="resend" disabled={pending}>
            Send a new code
          </IntentButton>
          {differentEmail}
        </div>
      </form>
    );
  }

  if (state.step === "set-password") {
    return (
      <form action={action} className={FORM}>
        {hidden}
        {fixedEmail}
        <p className="text-base text-ink">
          {state.replacing
            ? "You're signed in. Forgot your password? Set a new one here, or skip this if you remember it."
            : "You're signed in. Optional: choose a password so next time you can skip the email code."}
        </p>
        <Input
          type="password"
          name="newPassword"
          autoComplete="new-password"
          placeholder={
            state.replacing
              ? "New password (8+ characters)"
              : "Password (8+ characters)"
          }
          required
          minLength={8}
          autoFocus
          className={FIELD_LIGHT}
        />
        <Input
          type="password"
          name="confirm"
          autoComplete="new-password"
          placeholder="Repeat password"
          required
          minLength={8}
          className={FIELD_LIGHT}
        />
        <Button
          type="submit"
          name="intent"
          value="set-password"
          disabled={pending}
          className="self-start"
        >
          {pending
            ? "Saving…"
            : state.replacing
              ? "Set new password"
              : "Save password"}
        </Button>
        <Messages state={state} />
        <IntentButton intent="skip" disabled={pending}>
          Skip for now
        </IntentButton>
      </form>
    );
  }

  return (
    <form action={action} className={FORM}>
      {hidden}
      <Input
        type="email"
        name="email"
        defaultValue={state.email}
        autoComplete="email"
        placeholder="you@example.com"
        required
        autoFocus
        className={FIELD_LIGHT}
      />
      <Button
        type="submit"
        name="intent"
        value="lookup"
        disabled={pending}
        className="self-start"
      >
        {pending ? "One sec…" : "Continue"}
      </Button>
      <Messages state={state} />
    </form>
  );
}
