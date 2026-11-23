"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  savePassword,
  signOut,
  updateProfile,
  type FormState,
  type PasswordState,
} from "./actions";
import { retryable, submitKeepingDraft } from "@/lib/action-retry";
import PinInput from "@/v2/components/auth/PinInput";
import { SOCIAL_LINKS } from "@/lib/urls";
import { Button } from "@/v2/components/ui/button";
import { Input } from "@/v2/components/ui/input";
import { FIELD_LIGHT } from "@/v2/components/styles";
import { cn } from "@/v2/lib/utils";

const initial: FormState = {};
const submitProfile = retryable(updateProfile);

const LABEL = "text-sm font-semibold text-navy";
const TEXTAREA = cn(
  "min-h-28 w-full rounded-lg border-[1.5px] px-4 py-3 text-base transition-colors outline-none disabled:opacity-60",
  FIELD_LIGHT,
);

function Status({ state, saved }: { state: FormState; saved: string }) {
  return (
    <p aria-live="polite" className="min-h-5 text-sm">
      {state.error ? (
        <span className="text-meeple">{state.error}</span>
      ) : state.saved ? (
        <span className="text-ink/70">{saved}</span>
      ) : null}
    </p>
  );
}

export type ProfileValues = {
  name: string;
  pronouns: string;
  discordHandle: string;
  bio: string;
  isPublic: boolean;
};

type ProfileField = keyof ProfileValues;
const NONE: ReadonlySet<ProfileField> = new Set();

/** The fields whose current value differs from the one the form was rendered with. */
function dirtyFields(
  form: HTMLFormElement,
  v: ProfileValues,
): ReadonlySet<ProfileField> {
  const data = new FormData(form);
  const text = (key: ProfileField) => String(data.get(key) ?? "");
  const out = new Set<ProfileField>();
  for (const key of ["name", "pronouns", "discordHandle", "bio"] as const)
    if (text(key) !== v[key]) out.add(key);
  if (data.has("isPublic") !== v.isPublic) out.add("isPublic");
  return out;
}

// Unsaved fields go yellow and get a tag, since the Save button may be below
// the fold.
const UNSAVED_FIELD = "border-tan bg-peach/40 focus:border-tan";
const UNSAVED_TAG =
  "ml-2 rounded-full bg-peach px-2 py-0.5 text-xs font-semibold text-navy";

function Unsaved({ on }: { on: boolean }) {
  return on ? <span className={UNSAVED_TAG}>Unsaved</span> : null;
}

export function ProfileForm({
  email,
  profileHref,
  initialValues,
}: {
  email: string;
  profileHref: string;
  initialValues: ProfileValues;
}) {
  const [state, action, pending] = useActionState(submitProfile, initial);
  const [unsaved, setUnsaved] = useState(NONE);
  const [seen, setSeen] = useState(state);
  const v = initialValues;
  const dirty = unsaved.size > 0;
  const field = (key: ProfileField) =>
    cn(FIELD_LIGHT, unsaved.has(key) && UNSAVED_FIELD);

  if (state !== seen) {
    setSeen(state);
    if (state.saved) setUnsaved(NONE);
  }

  // What was saved may be normalized, and a hand submit doesn't reset by itself.
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.saved) formRef.current?.reset();
  }, [state]);

  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  return (
    <form
      ref={formRef}
      action={action}
      onSubmit={submitKeepingDraft(action)}
      onChange={(e) => setUnsaved(dirtyFields(e.currentTarget, v))}
      className="flex flex-col gap-4"
    >
      <h2 className="font-grotesk text-2xl font-bold text-navy">Profile</h2>
      <label className="flex flex-col gap-1.5">
        <span className="flex flex-col gap-0.5">
          <span className={LABEL}>
            Name
            <Unsaved on={unsaved.has("name")} />
          </span>
          <span className="text-sm text-ink/60">
            On RSVPs, hosting, badge, etc.
          </span>
        </span>
        <Input
          name="name"
          defaultValue={v.name}
          autoComplete="name"
          required
          maxLength={80}
          className={field("name")}
        />
      </label>
      <div className="flex flex-col gap-1.5">
        <span className={LABEL}>Email</span>
        <p className="text-base text-ink">{email}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>
            Pronouns
            <Unsaved on={unsaved.has("pronouns")} />
          </span>
          <Input
            name="pronouns"
            defaultValue={v.pronouns}
            maxLength={40}
            className={field("pronouns")}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>
            Discord handle{" "}
            <a
              href={SOCIAL_LINKS.DISCORD}
              target="_blank"
              rel="noreferrer"
              className="font-normal text-meeple underline-offset-2 hover:underline"
            >
              (Join!)
            </a>
            <Unsaved on={unsaved.has("discordHandle")} />
          </span>
          <Input
            name="discordHandle"
            defaultValue={v.discordHandle}
            maxLength={40}
            className={field("discordHandle")}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className={LABEL}>
          Bio
          <Unsaved on={unsaved.has("bio")} />
        </span>
        <textarea
          name="bio"
          defaultValue={v.bio}
          maxLength={1000}
          className={cn(TEXTAREA, unsaved.has("bio") && UNSAVED_FIELD)}
        />
      </label>
      <div className="flex flex-col gap-1">
        <label
          className={cn(
            "flex items-center gap-2.5 text-base text-ink",
            unsaved.has("isPublic") &&
              "-mx-2 rounded-lg border border-tan bg-peach/40 px-2 py-1",
          )}
        >
          <input
            type="checkbox"
            name="isPublic"
            defaultChecked={v.isPublic}
            className="size-4 accent-meeple"
          />
          Show my profile to other attendees
          <Unsaved on={unsaved.has("isPublic")} />
        </label>
        <p className="text-sm text-ink/60">
          Your page at{" "}
          <a href={profileHref} className="underline underline-offset-2">
            {profileHref}
          </a>{" "}
          shows your name, pronouns, photo, bio, link and the sessions
          you&rsquo;re hosting. Never your email, Discord handle or RSVPs, and
          never to the open web — it takes an account to open, and the
          organisers can see it either way.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Button
          type="submit"
          disabled={pending}
          className={cn(dirty && "ring-4 ring-tan/60")}
        >
          {pending ? "Saving…" : "Save profile"}
        </Button>
        {dirty && !pending && (
          <span className="text-sm font-semibold text-ink/70">
            Unsaved changes
          </span>
        )}
      </div>
      <Status state={dirty ? { error: state.error } : state} saved="Saved." />
    </form>
  );
}

const GREY_LINK =
  "self-start text-sm text-ink/55 underline-offset-2 hover:text-ink hover:underline";

const passwordInitial: PasswordState = { mode: "password" };
const submitPassword = retryable(savePassword);

/** True only while a submit carrying this `intent` is in flight, not any submit of the form. */
function useIntentPending(intent: string) {
  const { pending, data } = useFormStatus();
  return pending && data?.get("intent") === intent;
}

function IntentLink({
  intent,
  label,
  busy,
}: {
  intent: string;
  label: string;
  busy?: string;
}) {
  const { pending } = useFormStatus();
  const mine = useIntentPending(intent);
  return (
    <button
      type="submit"
      name="intent"
      value={intent}
      formNoValidate
      disabled={pending}
      className={GREY_LINK}
    >
      {mine && busy ? busy : label}
    </button>
  );
}

export function PasswordForm({
  hasPassword,
  email,
}: {
  hasPassword: boolean;
  email: string;
}) {
  const [state, action, pending] = useActionState(
    submitPassword,
    passwordInitial,
  );
  const byCode = state.mode === "code";

  return (
    <form action={action} className="flex flex-col gap-4">
      <h2 className="font-grotesk text-2xl font-bold text-navy">
        {hasPassword ? "Change password" : "Set a password"}
      </h2>
      {/* Tells password managers which account these new-password fields belong to. */}
      <input
        type="email"
        value={email}
        autoComplete="username"
        readOnly
        hidden
      />
      {!hasPassword && (
        <p className="text-sm text-ink/70">
          Optional. You can always sign in with an emailed code instead.
        </p>
      )}
      {hasPassword && byCode && (
        <div className="flex flex-col gap-3">
          <p className="text-base text-ink">
            We emailed a code to <strong>{email}</strong>.
          </p>
          <PinInput name="code" disabled={pending} />
          <div className="flex gap-5">
            <IntentLink
              intent="resend"
              label="Send a new code"
              busy="Sending…"
            />
            <IntentLink
              intent="cancel"
              label="Use my current password instead"
            />
          </div>
        </div>
      )}
      {hasPassword && !byCode && (
        <div className="flex flex-col gap-1.5">
          <Input
            type="password"
            name="currentPassword"
            autoComplete="current-password"
            placeholder="Current password"
            required
            className={FIELD_LIGHT}
          />
          <IntentLink
            intent="send"
            label="Forgot your current password?"
            busy="Sending a code…"
          />
        </div>
      )}
      <Input
        type="password"
        name="newPassword"
        autoComplete="new-password"
        placeholder="New password (8+ characters)"
        required
        minLength={8}
        className={FIELD_LIGHT}
      />
      <Input
        type="password"
        name="confirm"
        autoComplete="new-password"
        placeholder="Repeat new password"
        required
        minLength={8}
        className={FIELD_LIGHT}
      />
      <Button
        type="submit"
        name="intent"
        value={byCode ? "reset" : "change"}
        variant="navy"
        disabled={pending}
        className="self-start"
      >
        <SaveLabel
          intent={byCode ? "reset" : "change"}
          label={
            byCode
              ? "Set new password"
              : hasPassword
                ? "Change password"
                : "Set password"
          }
        />
      </Button>
      <p aria-live="polite" className="min-h-5 text-sm">
        {state.error ? (
          <span className="text-meeple">{state.error}</span>
        ) : (
          <span className="text-ink/70">
            {state.saved ? "Password saved." : state.notice}
          </span>
        )}
      </p>
    </form>
  );
}

function SaveLabel({ intent, label }: { intent: string; label: string }) {
  return useIntentPending(intent) ? "Saving…" : label;
}

export function SignOutButton() {
  return (
    <form action={signOut}>
      <Button
        type="submit"
        variant="ghost"
        className="border-navy/40 text-navy"
      >
        Sign out
      </Button>
    </form>
  );
}
