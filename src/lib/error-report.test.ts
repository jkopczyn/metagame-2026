import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: {
    DISCORD_ERROR_WEBHOOK_URL: "https://discord.test/hook",
    DISCORD_STAFF_WEBHOOK_URL: "https://discord.test/staff",
  },
}));
const adminEmail = vi.fn();
vi.mock("@/lib/email", () => ({
  sendAdminErrorEmail: (...args: unknown[]) => adminEmail(...args),
}));

import {
  BRIAN_DISCORD_ID,
  ON_SITE_ROLE_ID,
  formatErrorReport,
  reportError,
  reportErrorOnce,
  reportRequestError,
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

  it("sends staff issues to the staff channel, pinging the on-site role", async () => {
    const fetch = vi.fn(async () => new Response("", { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    await reportError({ source: "Desk", summary: "help", channel: "staff" });
    const [url, init] = fetch.mock.calls[0] as unknown as [
      string,
      { body: string },
    ];
    expect(url).toBe("https://discord.test/staff");
    const body = JSON.parse(init.body);
    expect(body.content).toContain("Staff issue");
    expect(body.content).toContain(`<@&${ON_SITE_ROLE_ID}>`);
    expect(body.content).not.toContain(BRIAN_DISCORD_ID);
    expect(body.allowed_mentions).toEqual({ roles: [ON_SITE_ROLE_ID] });
  });

  it("never throws when Discord is down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("rate limited", { status: 429 })),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      reportError({ source: "s", summary: "t", mention: false }),
    ).resolves.toBe(false);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("reportErrorOnce", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reports a key once per window, then again after it", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-06T00:00:00Z"));
    const report = { source: "S", summary: "s", mention: false };
    await reportErrorOnce("window", report);
    await reportErrorOnce("window", report);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-11-06T00:11:00Z"));
    await reportErrorOnce("window", report);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caps distinct keys, so an outage can't flood the channel", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-06T01:00:00Z"));
    for (let i = 0; i < 40; i++) {
      await reportErrorOnce(`key-${i}`, { source: "S", summary: "s" });
    }
    expect(fetchMock).toHaveBeenCalledTimes(20);
  });
});

describe("reportRequestError", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const request = { path: "/schedule?token=secret", method: "GET" };
  const context = { routePath: "/schedule", routeType: "render" };

  function setup() {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-06T02:00:00Z"));
    const sent = () =>
      JSON.parse(
        ((fetchMock.mock.calls as unknown[][])[0][1] as RequestInit)
          .body as string,
      ) as { content: string; allowed_mentions: { users: string[] } };
    return { fetchMock, sent };
  }

  it("stays quiet outside production", async () => {
    const { fetchMock } = setup();
    await reportRequestError(new Error("boom"), request, context);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports without a ping, the query or a second copy", async () => {
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "production");
    const { fetchMock, sent } = setup();
    const err = Object.assign(new Error("boom"), { digest: "123" });
    await reportRequestError(err, request, context);
    await reportRequestError(err, request, context);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sent().allowed_mentions.users).toEqual([]);
    expect(sent().content).toContain("/schedule");
    expect(sent().content).toContain("123");
    expect(sent().content).not.toContain("secret");
    expect(sent().content).not.toContain(`<@${BRIAN_DISCORD_ID}>`);
  });
});
