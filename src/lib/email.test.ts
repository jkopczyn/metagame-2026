import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());
vi.mock("@/env", () => ({ env: { RESEND_API_KEY: "re_test" } }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));

import {
  escapeHtml,
  renderTicketConfirmationEmail,
  sendAccountInviteEmail,
  sendAdminErrorEmail,
} from "./email";

const MARKUP = `<a href="https://x.example">O'Brien & co</a>`;
const ESCAPED =
  "&lt;a href=&quot;https://x.example&quot;&gt;O&#39;Brien &amp; co&lt;/a&gt;";

beforeEach(() => {
  vi.clearAllMocks();
  send.mockResolvedValue({ error: null });
});

it("escapes every markup character", () => {
  expect(escapeHtml(MARKUP)).toBe(ESCAPED);
});

describe("renderTicketConfirmationEmail", () => {
  const { html, text } = renderTicketConfirmationEmail({
    to: `"${MARKUP}"@example.com`,
    purchaserName: MARKUP,
    tierLabel: MARKUP,
    usdPaid: 0,
    usdFull: 100,
    discountCode: MARKUP,
    receiptUrl: "https://stripe.example/r?a=1&b=2",
    mailingListOptOutUrl: 'https://metagame.games/o?x="1"&y=2',
  });

  it("escapes what people typed in the HTML body", () => {
    expect(html).not.toContain(MARKUP);
    expect(html).toContain(`Hi ${ESCAPED},`);
    expect(html).toContain(`<strong>Name:</strong> ${ESCAPED}`);
    expect(html).toContain(`<strong>Type:</strong> ${ESCAPED}`);
    expect(html).toContain(`<strong>${ESCAPED}</strong>`);
    expect(html).toContain('href="https://stripe.example/r?a=1&amp;b=2"');
    expect(html).toContain(
      'href="https://metagame.games/o?x=&quot;1&quot;&amp;y=2"',
    );
  });

  it("leaves the plain-text body as typed", () => {
    expect(text).toContain(`Hi ${MARKUP},`);
    expect(text).toContain(`- Name: ${MARKUP}`);
    expect(text).toContain(`- Type: ${MARKUP}`);
    expect(text).not.toContain("&lt;");
    expect(text).toContain("https://stripe.example/r?a=1&b=2");
  });

  it("still greets a nameless buyer", () => {
    const nameless = renderTicketConfirmationEmail({
      to: "a@example.com",
      tierLabel: "Standard",
    });
    expect(nameless.html).toContain("Hi there,");
    expect(nameless.html).toContain("<strong>Name:</strong> —");
  });
});

it("escapes the name in an account invite's HTML only", async () => {
  await sendAccountInviteEmail({ to: "a@example.com", name: MARKUP });
  const { html, text } = send.mock.calls[0][0];
  expect(html).toContain(`Hi ${ESCAPED},`);
  expect(html).not.toContain(MARKUP);
  expect(text).toContain(`Hi ${MARKUP},`);
});

it("escapes the admin error email and keeps its line breaks", async () => {
  await sendAdminErrorEmail(`Contact form\n\nFrom: ${MARKUP}`);
  const { html } = send.mock.calls[0][0];
  expect(html).toContain(ESCAPED);
  expect(html).not.toContain(MARKUP);
  expect(html).toContain("white-space: pre-wrap");
});
