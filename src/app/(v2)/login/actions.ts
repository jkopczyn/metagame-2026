"use server";

import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  API_KEY_HEADER,
  codeDelivered,
  currentSession,
  getAuth,
  hasPassword,
  replacePassword,
} from "@/lib/auth";
import { getDb, schema } from "@/db";
import {
  beginLoginAttempt,
  clientIp,
  MAX_EMAIL_LENGTH,
} from "@/lib/login-throttle";
import { safeNextPath } from "@/lib/next-path";

// Email first, then whatever that address calls for:
//   email ─lookup─┬─ has a password ──▶ password  (or ask for a code)
//                 ├─ no password yet ──▶ code      (sent straight away)
//                 └─ no account ───────▶ new       (confirm, then code)
//   code ─verify─▶ set-password (optional) ─▶ next
export type AuthState = {
  step: "email" | "password" | "code" | "new" | "set-password";
  email: string;
  /** The set-password step is replacing an existing password, not adding a first one. */
  replacing?: boolean;
  error?: string;
  notice?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FRESH_SESSION_MS = 10 * 60 * 1000;
const SERVER_ERROR = "Something went wrong on our side. Try again in a minute.";

const apiCode = (e: unknown) =>
  e instanceof APIError ? e.body?.code : undefined;

/** The account under this address, if any, and whether it has a password. */
async function lookup(
  email: string,
): Promise<{ exists: boolean; password: boolean }> {
  const [row] = await getDb()
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .limit(1);
  if (!row) return { exists: false, password: false };
  return { exists: true, password: await hasPassword(row.id) };
}

async function sendCode(email: string): Promise<string | undefined> {
  const failed = "We couldn't send the email. Try again in a minute.";
  try {
    const delivered = await codeDelivered(() =>
      getAuth().api.sendVerificationOTP({
        body: { email, type: "sign-in" },
      }),
    );
    if (!delivered) return failed;
  } catch (e) {
    console.error("[auth] sending code failed", e);
    return failed;
  }
}

async function toCodeStep(email: string, notice?: string): Promise<AuthState> {
  const error = await sendCode(email);
  if (error) return { step: "email", email, error };
  return { step: "code", email, notice };
}

// One action for the whole form; `intent` says which button was pressed.
export async function authenticate(
  prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const intent = String(formData.get("intent") ?? "");
  const email = String(formData.get("email") ?? prev.email)
    .trim()
    .toLowerCase();
  const next = safeNextPath(formData.get("next"));

  if (intent === "skip") redirect(next);

  if (intent === "set-password") {
    const session = await currentSession();
    const requestHeaders = await headers();
    // Only a session minted just now (by the code above, or a password) may
    // replace a password without the old one; a stolen older session can't.
    // An API key's stand-in session always reads as new, so it never counts.
    const fresh =
      session &&
      !requestHeaders.has(API_KEY_HEADER) &&
      Date.now() - new Date(session.session.createdAt).getTime() <
        FRESH_SESSION_MS;
    if (!session || !fresh) {
      return {
        step: "email",
        email,
        error: "Sign in again to set a password.",
      };
    }
    const replacing = await hasPassword(session.user.id);
    const fail = (error: string): AuthState => ({
      step: "set-password",
      email,
      replacing,
      error,
    });
    const newPassword = String(formData.get("newPassword") ?? "");
    if (newPassword.length < 8) return fail("Use at least 8 characters.");
    if (newPassword !== String(formData.get("confirm") ?? "")) {
      return fail("The passwords don't match.");
    }
    if (replacing) {
      await replacePassword(session.user.id, newPassword);
      await getAuth().api.revokeOtherSessions({ headers: requestHeaders });
    } else {
      await getAuth().api.setPassword({
        body: { newPassword },
        headers: requestHeaders,
      });
    }
    redirect(next);
  }

  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) {
    return { step: "email", email, error: "Enter a valid email address." };
  }

  if (intent === "lookup") {
    const { exists, password } = await lookup(email);
    if (!exists) return { step: "new", email };
    if (password) return { step: "password", email };
    return toCodeStep(
      email,
      "This account has no password yet, so we emailed you a code.",
    );
  }

  if (intent === "code") return toCodeStep(email);
  if (intent === "resend") return toCodeStep(email, "Sent a new code.");

  if (intent === "password") {
    const password = String(formData.get("password") ?? "");
    if (!password)
      return { step: "password", email, error: "Enter your password." };
    const requestHeaders = await headers();
    const attempt = await beginLoginAttempt(
      "password",
      email,
      clientIp(requestHeaders),
    );
    if (!attempt) {
      return {
        step: "password",
        email,
        error:
          "Too many tries. Email yourself a code instead, or try again in a few minutes.",
      };
    }
    try {
      await getAuth().api.signInEmail({
        body: { email, password },
        headers: requestHeaders,
      });
    } catch (e) {
      if (apiCode(e) === "EMAIL_NOT_VERIFIED") {
        await attempt.release();
        // Nobody has proved they own this address yet, so its password can't
        // be trusted. Signing in by code also clears that password.
        return toCodeStep(
          email,
          "This address hasn't been verified yet, so we emailed you a code instead.",
        );
      }
      if (apiCode(e) !== "INVALID_EMAIL_OR_PASSWORD") {
        console.error("[auth] password sign-in failed", e);
        await attempt.release();
        return { step: "password", email, error: SERVER_ERROR };
      }
      return {
        step: "password",
        email,
        error: "That password didn't match. Forgot it? Email yourself a code.",
      };
    }
    await attempt.succeeded();
    redirect(next);
  }

  if (intent === "verify") {
    const otp = String(formData.get("code") ?? "").replace(/\D/g, "");
    if (otp.length !== 6) {
      return { step: "code", email, error: "Enter the 6-digit code." };
    }
    const requestHeaders = await headers();
    const attempt = await beginLoginAttempt(
      "code",
      email,
      clientIp(requestHeaders),
    );
    if (!attempt) {
      return {
        step: "code",
        email,
        error: "Too many tries. Wait a few minutes, then try again.",
      };
    }
    let userId: string;
    try {
      // Creates the account when the address is new.
      const result = await getAuth().api.signInEmailOTP({
        body: { email, otp },
        headers: requestHeaders,
      });
      userId = result.user.id;
    } catch (e) {
      const code = apiCode(e);
      if (code === "OTP_EXPIRED") {
        return {
          step: "code",
          email,
          error: "That code expired. Send a new one.",
        };
      }
      if (code === "TOO_MANY_ATTEMPTS") {
        return {
          step: "code",
          email,
          error: "Too many tries. Send a new code.",
        };
      }
      if (code === "INVALID_OTP") {
        return { step: "code", email, error: "That code didn't match." };
      }
      console.error("[auth] code sign-in failed", e);
      await attempt.release();
      return { step: "code", email, error: SERVER_ERROR };
    }
    await attempt.succeeded();
    // Signed in. Offer a password: a first one for new and password-less
    // accounts, a replacement where a code was the way past a forgotten one.
    return {
      step: "set-password",
      email,
      replacing: await hasPassword(userId),
    };
  }

  return prev;
}
