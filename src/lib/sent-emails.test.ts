import { describe, expect, it } from "vitest";
import {
  catalogEmailFiles,
  emailSubject,
  findEmail,
  groupEmailFiles,
  isEmailSlug,
  listEmails,
  previewEmail,
  readEmail,
} from "./sent-emails";

describe("groupEmailFiles", () => {
  it("makes one entry per .html with the variants beside it", () => {
    expect(
      groupEmailFiles([
        "CLAUDE.md",
        "welcome.html",
        "announcement.txt",
        "announcement.min.html",
        "announcement.html",
        "stray.min.html",
        "Bad Name.html",
      ]),
    ).toEqual([
      { slug: "announcement", variants: ["html", "min", "txt"] },
      { slug: "welcome", variants: ["html"] },
    ]);
  });
});

describe("catalogEmailFiles", () => {
  it("tags each folder's emails with its status", () => {
    expect(
      catalogEmailFiles({
        sent: ["welcome.html", "drafts"],
        draft: ["one-week-out.html", "one-week-out.txt"],
      }),
    ).toEqual([
      { slug: "welcome", status: "sent", variants: ["html"] },
      { slug: "one-week-out", status: "draft", variants: ["html", "txt"] },
    ]);
  });
  it("drops a draft whose slug a sent email already uses", () => {
    expect(
      catalogEmailFiles({
        sent: ["welcome.html"],
        draft: ["welcome.html", "welcome.txt", "later.html"],
      }),
    ).toEqual([
      { slug: "welcome", status: "sent", variants: ["html"] },
      { slug: "later", status: "draft", variants: ["html"] },
    ]);
  });
});

describe("emailSubject", () => {
  it("reads the title, decoding entities", () => {
    expect(
      emailSubject("<html><title>\n  You&#8217;re on &amp; in </title>", "x"),
    ).toBe("You’re on & in");
  });
  it("falls back to the slug", () => {
    expect(emailSubject("<html></html>", "welcome")).toBe("welcome");
  });
});

it("previewEmail fills the EmailOctopus tags and leaves the rest", () => {
  expect(
    previewEmail(
      '<a href="{{UnsubscribeURL}}">x</a> {{Other}} {{SenderInfoLine}}',
    ),
  ).toBe(
    '<a href="#">x</a> {{Other}} Metagame · (sender address filled in by EmailOctopus)',
  );
});

it("isEmailSlug rejects paths", () => {
  expect(isEmailSlug("welcome")).toBe(true);
  expect(isEmailSlug("../welcome")).toBe(false);
  expect(isEmailSlug("a/b")).toBe(false);
  expect(isEmailSlug("")).toBe(false);
});

describe("the emails/ folder", () => {
  it("lists the saved emails with their status", async () => {
    const emails = await listEmails();
    const welcome = emails.find((e) => e.slug === "welcome");
    expect(welcome).toMatchObject({
      status: "sent",
      subject: "You're on the Metagame mailing list",
      variants: ["html"],
    });
    expect(welcome!.bytes).toBeGreaterThan(0);
    expect(
      emails.filter((e) => e.status === "draft").map((e) => e.slug),
    ).toContain("one-week-out");
    expect(await findEmail("one-week-out")).toMatchObject({ status: "draft" });
  });
  it("reads a variant from either folder and refuses an unknown or unsafe slug", async () => {
    expect(await readEmail("welcome")).toContain("<html");
    expect(await readEmail("one-week-out")).toContain("<html");
    expect(await readEmail("welcome", "txt")).toBeNull();
    expect(await readEmail("nope")).toBeNull();
    expect(await readEmail("../package")).toBeNull();
    expect(await readEmail("drafts/one-week-out")).toBeNull();
  });
});
