import { apiKey } from "@better-auth/api-key";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin, emailOTP } from "better-auth/plugins";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { cache } from "react";
import { getDb, schema, type Db } from "@/db";
import { env } from "@/env";
import { sendSignInCodeEmail } from "@/lib/email";

export const API_KEY_HEADER = "x-api-key";

function createAuth() {
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is not set — see .env.example");
  }
  const db = getDb();

  return betterAuth({
    appName: "Metagame",
    secret,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    // No baseURL: it's taken from each request, so previews and prod work on
    // whatever host they're served from.
    advanced: { useSecureCookies: process.env.NODE_ENV === "production" },
    telemetry: { enabled: false },
    // Public routes that email a code would skip /login's budgets. The app calls
    // these server-side, which disabledPaths doesn't affect.
    disabledPaths: [
      "/email-otp/send-verification-otp",
      "/email-otp/request-password-reset",
      "/forget-password/email-otp",
    ],
    emailAndPassword: {
      enabled: true,
      // Accounts only come from proving the email with a code; a password is
      // added afterwards on /account and refused until the email is verified.
      disableSignUp: true,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
    },
    session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await db
              .insert(schema.profiles)
              .values({ userId: user.id })
              .onConflictDoNothing();
          },
        },
      },
    },
    plugins: [
      emailOTP({
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (await sentRecently(db, email, otp)) return;
          await sendSignInCodeEmail({ to: email, code: otp, type });
        },
        // Resends extend the same code rather than minting a new one, so a
        // send skipped by the cooldown leaves the person with a working code.
        resendStrategy: "reuse",
        expiresIn: 10 * 60,
        allowedAttempts: 5,
      }),
      admin(),
      // A request with `x-api-key: <key>` reads as a session for the key's
      // owner, so can() gates the JSON API the same way it gates the pages.
      // Keys are minted on /backstage/api-keys.
      apiKey({
        apiKeyHeaders: API_KEY_HEADER,
        defaultPrefix: "mg_",
        enableSessionForAPIKeys: true,
        rateLimit: { enabled: false },
      }),
      nextCookies(),
    ],
  });
}

const SEND_COOLDOWN_MS = 30 * 1000;

/**
 * Whether this exact code was emailed to this address in the last 30s. The
 * send buttons are server actions, outside Better Auth's per-IP rate limit,
 * so this is what stops someone spamming codes at an inbox. A rotated code
 * (attempts used up) always goes out.
 */
async function sentRecently(db: Db, email: string, otp: string) {
  const { verification } = schema;
  const identifier = `code-sent:${email}`;
  const now = new Date();
  const [last] = await db
    .select({ value: verification.value, expiresAt: verification.expiresAt })
    .from(verification)
    .where(eq(verification.identifier, identifier))
    .limit(1);
  if (last && last.value === otp && last.expiresAt > now) return true;
  await db.delete(verification).where(eq(verification.identifier, identifier));
  await db.insert(verification).values({
    id: crypto.randomUUID(),
    identifier,
    value: otp,
    expiresAt: new Date(now.getTime() + SEND_COOLDOWN_MS),
  });
  return false;
}

export type Auth = ReturnType<typeof createAuth>;

let cached: Auth | null = null;

/** Built lazily, like getDb(), so modules can import this without the env set. */
export function getAuth(): Auth {
  return (cached ??= createAuth());
}

export type Session = NonNullable<
  Awaited<ReturnType<Auth["api"]["getSession"]>>
>;

/** Whether this deploy can mint and read account sessions at all. */
export const accountsConfigured = () =>
  Boolean(env.BETTER_AUTH_SECRET && env.DATABASE_URL);

/** The signed-in user for the current request, or null. Memoized per request. */
export const currentSession = cache(async (): Promise<Session | null> => {
  // headers() first: it marks the render dynamic, so `next build` never tries
  // to prerender a page through getAuth() (which needs the env).
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
});

/**
 * What the account goes by: its name, else the email (code sign-in registers
 * without a name).
 */
export function accountLabel(user: Session["user"]): string {
  return user.name.trim() || user.email;
}

/** Signs the account out of the site. */
export async function signOutAccount(): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() });
}

/** Whether the user has a password to sign in with (a "credential" account row). */
export async function hasPassword(userId: string): Promise<boolean> {
  const { account } = schema;
  const rows = await getDb()
    .select({ id: account.id })
    .from(account)
    .where(
      and(eq(account.userId, userId), eq(account.providerId, "credential")),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Replaces the password without checking the current one. Only for callers
 * that just proved the email with a code; that proof is the reset token.
 */
export async function replacePassword(userId: string, newPassword: string) {
  const ctx = await getAuth().$context;
  const hash = await ctx.password.hash(newPassword);
  await ctx.internalAdapter.updatePassword(userId, hash);
}
