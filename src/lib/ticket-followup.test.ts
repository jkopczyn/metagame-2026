import { describe, expect, it } from "vitest";
import { renderOneWeekOutEmail } from "./ticket-followup";

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
