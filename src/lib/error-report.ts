import { env } from "@/env";
import { sendAdminErrorEmail } from "@/lib/email";

/** Brian's Discord user id — pinged on errors that need a person to look. */
export const BRIAN_DISCORD_ID = "223327095239999489";

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
  const { source, summary, details = {}, error, mention = true } = report;
  const when = (context.now ?? new Date())
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
  const where = [context.deployment, context.host].filter(Boolean).join(" · ");
  const head = [
    `🚨 **Website error:** ${source}`,
    ...(mention ? [`<@${BRIAN_DISCORD_ID}>`] : []),
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
 * Tell the team something broke: a message in the Discord error channel
 * (DISCORD_ERROR_WEBHOOK_URL), or the admin email while that isn't set.
 * Best-effort — never throws, so it's safe inside a catch.
 */
export async function reportError(report: ErrorReport): Promise<void> {
  const text = formatErrorReport(report, reportContext());
  const webhook = env.DISCORD_ERROR_WEBHOOK_URL;
  try {
    if (!webhook) {
      await sendAdminErrorEmail(
        `${report.source} — ${report.summary}\n\n${text}`,
      );
      return;
    }
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: text,
        allowed_mentions: {
          users: report.mention === false ? [] : [BRIAN_DISCORD_ID],
        },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok)
      throw new Error(`Discord responded ${res.status}: ${await res.text()}`);
  } catch (err) {
    console.error(
      `[error-report] couldn't report "${report.source}":`,
      err,
      "\n",
      text,
    );
  }
}
