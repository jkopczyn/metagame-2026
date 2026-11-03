import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: { DISCORD_ERROR_WEBHOOK_URL: "https://discord.test/hook" },
}));
const adminEmail = vi.fn();
vi.mock("@/lib/email", () => ({
  sendAdminErrorEmail: (...args: unknown[]) => adminEmail(...args),
}));

import {
  BRIAN_DISCORD_ID,
  formatErrorReport,
  reportError,
} from "./error-report";

const now = new Date("2026-11-01T03:04:05Z");

describe("formatErrorReport", () => {
  it("lays the report out like the other channel bots, pinging Brian", () => {
    const text = formatErrorReport(
      {
        source: "Contact form",
        summary: "The message didn't send",
        details: { From: "Ada <ada@example.com>", Subject: "", Empty: null },
        error: new Error("Resend send failed: boom"),
      },
      { deployment: "production", host: "metagame.games", now },
    );
    expect(text.split("\n").slice(0, 5)).toEqual([
      "🚨 **Website error:** Contact form",
      `<@${BRIAN_DISCORD_ID}>`,
      "📝 **What:** The message didn't send",
      "🔹 **From:** Ada <ada@example.com>",
      "🕒 **When:** 2026-11-01 03:04:05 UTC (production · metagame.games)",
    ]);
    expect(text).not.toContain("Subject");
    expect(text).not.toContain("Empty");
    expect(text).toContain("```\nError: Resend send failed: boom");
  });

  it("leaves the ping out when asked", () => {
    const text = formatErrorReport(
      { source: "Egg", summary: "meh", mention: false },
      { now },
    );
    expect(text).not.toContain("<@");
    expect(text).not.toContain("💥");
  });

  it("stays under Discord's message limit", () => {
    const text = formatErrorReport(
      {
        source: "Forms",
        summary: "Airtable responded 422",
        error: new Error("x".repeat(5000)),
      },
      { now },
    );
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text.endsWith("…\n```")).toBe(true);
  });

  it("describes non-Error throws too", () => {
    expect(
      formatErrorReport({ source: "s", summary: "t", error: "plain" }, { now }),
    ).toContain("```\nplain\n```");
    expect(
      formatErrorReport(
        { source: "s", summary: "t", error: { code: 7 } },
        { now },
      ),
    ).toContain('{"code":7}');
  });
});

describe("reportError", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    adminEmail.mockReset();
  });

  it("posts to the webhook, only letting Brian's mention ping", async () => {
    const fetch = vi.fn(async () => new Response("", { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    await reportError({ source: "Contact form", summary: "nope" });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [
      string,
      { body: string },
    ];
    expect(url).toBe("https://discord.test/hook");
    const body = JSON.parse(init.body);
    expect(body.content).toContain("Contact form");
    expect(body.allowed_mentions).toEqual({ users: [BRIAN_DISCORD_ID] });
    expect(adminEmail).not.toHaveBeenCalled();
  });

  it("never throws when Discord is down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("rate limited", { status: 429 })),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      reportError({ source: "s", summary: "t", mention: false }),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
