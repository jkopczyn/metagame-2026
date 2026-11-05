import { and, count, eq, inArray, like, lte, or, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/db";

export type LoginFactor = "password" | "code";

const { verification } = schema;
const PREFIX = "login-attempt:";
const WINDOW_MS = 15 * 60 * 1000;

/** No real address is longer, and these keys end up in an indexed column. */
export const MAX_EMAIL_LENGTH = 254;

// Per address is the real limit. Per IP only catches one client spraying many
// addresses, and sits high because a venue's wifi puts everyone on one IP.
export const LOGIN_LIMITS: Record<LoginFactor, { email: number; ip: number }> =
  {
    password: { email: 10, ip: 2000 },
    code: { email: 30, ip: 2000 },
  };

const bucket = (factor: LoginFactor, scope: "email" | "ip", key: string) =>
  `${PREFIX}${factor}:${scope}:${key}`;

/** Vercel sets this header itself, so a client can't choose its leftmost entry. */
export function clientIp(headers: Headers): string | null {
  return headers.get("x-forwarded-for")?.split(",")[0].trim() || null;
}

export type LoginAttempt = {
  /** The credential was right: forgets this address's earlier failures too. */
  succeeded(): Promise<void>;
  /** The attempt proved nothing either way, so it doesn't count. */
  release(): Promise<void>;
};

/**
 * Counts a password or code check before it runs, or returns null when one of
 * its limits is used up. Left unresolved, the attempt stands as a failure for
 * the window. Reserving first means parallel guesses can't all pass the count.
 * Each factor counts apart, so running out of password tries leaves code
 * sign-in, the recovery path, working.
 */
export async function beginLoginAttempt(
  factor: LoginFactor,
  email: string,
  ip: string | null,
): Promise<LoginAttempt | null> {
  const db = getDb();
  const now = new Date();
  const limits = LOGIN_LIMITS[factor];
  const buckets = [
    { identifier: bucket(factor, "email", email), limit: limits.email },
    ...(ip ? [{ identifier: bucket(factor, "ip", ip), limit: limits.ip }] : []),
  ];
  await db
    .delete(verification)
    .where(
      and(
        like(verification.identifier, `${PREFIX}%`),
        lte(verification.expiresAt, now),
      ),
    );
  const rows = buckets.map(({ identifier }) => ({
    id: crypto.randomUUID(),
    identifier,
    value: factor,
    expiresAt: new Date(now.getTime() + WINDOW_MS),
  }));
  await db.insert(verification).values(rows);

  const mine = inArray(
    verification.id,
    rows.map((row) => row.id),
  );
  // Never fails the sign-in: a row left behind only ages out with the window.
  const forget = async (rows: SQL | undefined) => {
    try {
      await db.delete(verification).where(rows);
    } catch (e) {
      console.error("[auth] clearing login attempts failed", e);
    }
  };
  const release = () => forget(mine);

  const counts = await db
    .select({ identifier: verification.identifier, attempts: count() })
    .from(verification)
    .where(
      inArray(
        verification.identifier,
        buckets.map((b) => b.identifier),
      ),
    )
    .groupBy(verification.identifier)
    .catch(async (e: unknown) => {
      await release();
      throw e;
    });
  const over = buckets.some(({ identifier, limit }) =>
    counts.some((c) => c.identifier === identifier && c.attempts > limit),
  );
  if (over) {
    // A refused try isn't kept, or retrying would extend the lockout forever.
    await release();
    return null;
  }

  return {
    release,
    succeeded: () =>
      forget(
        or(
          mine,
          eq(verification.identifier, bucket("password", "email", email)),
          eq(verification.identifier, bucket("code", "email", email)),
        ),
      ),
  };
}
