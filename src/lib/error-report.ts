import { env } from "@/env";
import { sendAdminErrorEmail } from "@/lib/email";

/** Brian's Discord user id — pinged on errors that need a person to look. */
export const BRIAN_DISCORD_ID = "223327095239999489";
/** The "On Site" role in the Metagame Discord — pinged on staff issues. */
export const ON_SITE_ROLE_ID = "1567964251585515580";

/** Which channel a report lands in: website-errors (bugs, pings Brian) or staff-issues (people problems, pings on-site staff). */
export type ReportChannel = "errors" | "staff";

const DISCORD_MESSAGE_LIMIT = 2000;

export type ErrorReport = {
  /** What broke, e.g. "Contact form" or "Stripe webhook". */
  source: string;
  /** One line on what failed and what it means for the person affected. */
  summary: string;
  /** Labelled context lines; empty values are left out. */
  details?: Record<string, string | number | boolean | null | undefined>;
  /** The thrown error, if any. */
  error?: unknown;
  /** Ping Brian. On by default; turn off for things nobody needs to act on. */
  mention?: boolean;
  /** Defaults to "errors". */
  channel?: ReportChannel;
};

export type ReportContext = {
  /** "production", "preview" or "development". */
  deployment?: string;
  /** Host of the deployment that hit the error. */
  host?: string;
  now?: Date;
};

function describeError(error: unknown): string | undefined {
  if (error == null) return undefined;
  if (error instanceof Error) {
    const lines = [`${error.name}: ${error.message}`];
    const frames = (error.stack ?? "")
      .split("\n")
      .slice(1)
      .filter((l) => l.trim().startsWith("at "))
      .slice(0, 4);
    return [...lines, ...frames].join("\n");
  }
  return typeof error === "string" ? error : JSON.stringify(error);
}

/** Lays out a report as one Discord message, kept under the 2000-char limit. */
export function formatErrorReport(
  report: ErrorReport,
  context: ReportContext = {},
): string {
  const {
    source,
    summary,
    details = {},
    error,
    mention = true,
    channel = "errors",
  } = report;
  const when = (context.now ?? new Date())
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
  const where = [context.deployment, context.host].filter(Boolean).join(" · ");
  const head = [
    channel === "staff"
      ? `🙋 **Staff issue:** ${source}`
      : `🚨 **Website error:** ${source}`,
    ...(channel === "staff"
      ? [`<@&${ON_SITE_ROLE_ID}>`]
      : mention
        ? [`<@${BRIAN_DISCORD_ID}>`]
        : []),
    `📝 **What:** ${summary}`,
    ...Object.entries(details)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `🔹 **${k}:** ${String(v)}`),
    `🕒 **When:** ${when} UTC${where ? ` (${where})` : ""}`,
  ].join("\n");

  const described = describeError(error);
  if (!described) return head.slice(0, DISCORD_MESSAGE_LIMIT);

  const wrap = (text: string) =>
    `${head}\n💥 **Error:**\n\`\`\`\n${text}\n\`\`\``;
  const room = DISCORD_MESSAGE_LIMIT - wrap("").length - 1;
  const body =
    described.length > room
      ? `${described.slice(0, Math.max(0, room - 1))}…`
      : described;
  return wrap(body);
}

function reportContext(): ReportContext {
  return {
    deployment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    host: process.env.VERCEL_URL,
  };
}

/**
 * Tell the team something's up: a message in the Discord channel for the
 * report (DISCORD_ERROR_WEBHOOK_URL / DISCORD_STAFF_WEBHOOK_URL), or the admin
 * email while that isn't set. Best-effort — never throws, so it's safe inside
 * a catch. False when the report didn't go out.
 */
export async function reportError(report: ErrorReport): Promise<boolean> {
  const text = formatErrorReport(report, reportContext());
  const webhook =
    report.channel === "staff"
      ? env.DISCORD_STAFF_WEBHOOK_URL
      : env.DISCORD_ERROR_WEBHOOK_URL;
  try {
    if (!webhook) {
      await sendAdminErrorEmail(
        `${report.source} — ${report.summary}\n\n${text}`,
      );
      return true;
    }
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: text,
        allowed_mentions:
          report.channel === "staff"
            ? { roles: [ON_SITE_ROLE_ID] }
            : { users: report.mention === false ? [] : [BRIAN_DISCORD_ID] },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok)
      throw new Error(`Discord responded ${res.status}: ${await res.text()}`);
    return true;
  } catch (err) {
    console.error(
      `[error-report] couldn't report "${report.source}":`,
      err,
      "\n",
      text,
    );
    return false;
  }
}
