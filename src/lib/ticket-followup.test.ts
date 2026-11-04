import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { send, createContact, reportError } = vi.hoisted(() => ({
  send: vi.fn(),
  createContact: vi.fn(),
  reportError: vi.fn(),
}));
vi.mock("@/lib/email", async (original) => ({
  ...(await original<typeof import("@/lib/email")>()),
  getResend: () => ({
    emails: { send },
    contacts: { create: createContact },
  }),
}));
vi.mock("@/lib/error-report", () => ({ reportError }));
vi.mock("@/lib/sent-emails", async (original) => ({
  ...(await original<typeof import("@/lib/sent-emails")>()),
  readEmail: async () => FIXTURE,
}));
import {
  followUpTicketPurchase,
  renderOneWeekOutEmail,
} from "./ticket-followup";

const OPENER =
  '<p style="margin:0 0 18px;font-size:17px;line-height:1.6;color:#1b1b1b;">We are less than a week out, and are super excited.</p>';

const FIXTURE = `<html>
<head>
  <title>Metagame is less than a week away</title>
</head>
<body>
  ${OPENER}
  <td>Metagame 2026<br><a href="https://metagame.games/" style="color:#173059;">metagame.games</a> &#183; <a href="{{UnsubscribeURL}}" style="color:#173059;">unsubscribe</a></td>
  <p style="margin:0 0 10px;">&copy; 2026 Metagame LLC</p>
  <p style="margin:10px 0 0;">{{SenderInfoLine}}</p>
  <p style="margin:10px 0 0;"><a href="{{RewardsURL}}" style="color:#a39b96;">Powered by EmailOctopus</a></p>
</body>
</html>
`;

describe("renderOneWeekOutEmail", () => {
  it("greets by first name above the opening paragraph", () => {
    const { html } = renderOneWeekOutEmail(FIXTURE, "Ada");
    expect(html).toContain(
      `<p style="margin:0 0 18px;font-size:17px;line-height:1.6;color:#1b1b1b;">Hi Ada,</p>\n${OPENER}`,
    );
  });

  it("falls back to 'there' without a name", () => {
    expect(renderOneWeekOutEmail(FIXTURE, undefined).html).toContain(
      "Hi there,</p>",
    );
    expect(renderOneWeekOutEmail(FIXTURE, "").html).toContain("Hi there,</p>");
  });

  it("escapes the name", () => {
    expect(renderOneWeekOutEmail(FIXTURE, "<b>").html).toContain(
      "Hi &lt;b&gt;,</p>",
    );
  });

  it("drops the EmailOctopus footer lines but keeps the site link", () => {
    const { html } = renderOneWeekOutEmail(FIXTURE, "Ada");
    expect(html).not.toContain("{{UnsubscribeURL}}");
    expect(html).not.toContain("{{SenderInfoLine}}");
    expect(html).not.toContain("{{RewardsURL}}");
    expect(html).not.toContain("unsubscribe");
    expect(html).not.toContain("Powered by EmailOctopus");
    expect(html).toContain(
      '<a href="https://metagame.games/" style="color:#173059;">metagame.games</a></td>',
    );
    expect(html).toContain("&copy; 2026 Metagame LLC");
  });

  it("takes the subject from <title>", () => {
    expect(renderOneWeekOutEmail(FIXTURE, "Ada").subject).toBe(
      "Metagame is less than a week away",
    );
  });

  it("throws when the opening paragraph is missing", () => {
    expect(() =>
      renderOneWeekOutEmail(FIXTURE.replace(OPENER, "<p>Hello.</p>"), "Ada"),
    ).toThrow(/opening paragraph/);
  });

  it("throws when a merge tag survives", () => {
    expect(() =>
      renderOneWeekOutEmail(`${FIXTURE}<p>{{RewardsURL}}</p>`, "Ada"),
    ).toThrow(/RewardsURL/);
  });
});

describe("followUpTicketPurchase", () => {
  const ok = { data: { id: "x" }, error: null, headers: null };
  const followUp = () =>
    followUpTicketPurchase({
      to: "ada@example.com",
      name: "Ada Lovelace",
      ticketType: "Standard",
      paymentId: "pi_1",
      test: false,
      source: "Stripe webhook",
    });

  beforeEach(() => {
    vi.clearAllMocks();
    send.mockResolvedValue(ok);
    createContact.mockResolvedValue(ok);
  });
  afterEach(() => void vi.useRealTimers());

  it("adds the contact and sends the email once per payment", async () => {
    await followUp();
    expect(createContact).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toEqual({
      idempotencyKey: "one-week-out/pi_1",
    });
  });

  it("rides out a rate limit on both steps", async () => {
    vi.useFakeTimers();
    const limited = {
      data: null,
      error: { name: "rate_limit_exceeded", message: "Too many requests" },
      headers: null,
    };
    createContact.mockResolvedValueOnce(limited);
    send.mockResolvedValueOnce(limited);
    const done = followUp();
    await vi.runAllTimersAsync();
    await done;
    expect(createContact).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(2);
    expect(reportError).not.toHaveBeenCalled();
  });
});
