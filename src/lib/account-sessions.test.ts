import { describe, expect, it } from "vitest";
import { accountSessions, sessionWhen } from "./account-sessions";
import type { ScheduleSession } from "./schedule";

const host = (userId: string) => ({ userId, name: userId, email: userId });

const session = (over: Partial<ScheduleSession>): ScheduleSession => ({
  id: "s",
  slug: "s",
  title: "S",
  description: null,
  category: null,
  startsAt: null,
  endsAt: null,
  locationId: null,
  maxCapacity: null,
  minCapacity: null,
  ages: null,
  needs: null,
  status: "published",
  rsvpIsCommitment: false,
  sponsored: false,
  airtableRfpRecordId: null,
  hosts: [],
  shepherd: null,
  ...over,
});

const noPlans = { rsvps: {}, bookmarks: [] };

describe("sessionWhen", () => {
  it("formats day and time range in Pacific", () => {
    expect(
      sessionWhen({
        startsAt: "2026-11-07T17:00:00.000Z",
        endsAt: "2026-11-07T17:55:00.000Z",
      }),
    ).toBe("Sat, Nov 7 · 9:00 AM – 9:55 AM");
  });

  it("is null while unscheduled", () => {
    expect(sessionWhen({ startsAt: null, endsAt: null })).toBeNull();
  });
});

describe("accountSessions", () => {
  const hosted = [
    session({ id: "tba", title: "A", hosts: [host("me")] }),
    session({
      id: "late",
      startsAt: "2026-11-08T18:00:00.000Z",
      hosts: [host("x"), host("me")],
    }),
    session({
      id: "draft",
      status: "draft",
      startsAt: "2026-11-07T18:00:00.000Z",
      hosts: [host("me")],
    }),
    session({ id: "other", hosts: [host("x")] }),
  ];

  it("hides hosted drafts from non-admins", () => {
    const out = accountSessions("me", hosted, [], noPlans, {}, false);
    expect(out.running.map((r) => r.id)).toEqual(["late", "tba"]);
  });

  it("lists an admin's hosted sessions, drafts included, scheduled first", () => {
    const out = accountSessions("me", hosted, [], noPlans, {}, true);
    expect(out.running.map((r) => [r.id, r.lead, r.status])).toEqual([
      ["draft", true, "draft"],
      ["late", false, "published"],
      ["tba", true, "published"],
    ]);
    expect(out.running.map((r) => [r.id, r.listed])).toEqual([
      ["draft", false],
      ["late", false],
      ["tba", false],
    ]);
  });

  it("keeps RSVPs and bookmarks to published sessions, bookmarks apart", () => {
    const out = accountSessions(
      "me",
      [
        session({
          id: "going",
          slug: "going",
          startsAt: "2026-11-07T17:00:00.000Z",
          endsAt: "2026-11-07T17:55:00.000Z",
          locationId: "r1",
          maxCapacity: 2,
        }),
        session({ id: "wait", title: "W" }),
        session({ id: "hidden", status: "draft" }),
        session({ id: "starred", title: "Z" }),
      ],
      [{ id: "r1", name: "Bayes" }],
      {
        rsvps: { going: "going", wait: "waitlist", hidden: "going" },
        bookmarks: ["going", "starred", "hidden"],
      },
      { going: { going: 2 } },
      false,
    );
    expect(out.plans.map((r) => [r.id, r.rsvp])).toEqual([
      ["going", "going"],
      ["wait", "waitlist"],
    ]);
    expect(out.plans[0]).toMatchObject({
      slug: "going",
      listed: true,
      room: "Bayes",
      bookmarked: true,
      full: true,
    });
    expect(out.bookmarks.map((r) => r.id)).toEqual(["starred"]);
  });

  it("flags a bookmark that clashes with an RSVP", () => {
    const out = accountSessions(
      "me",
      [
        session({
          id: "going",
          title: "Chess",
          startsAt: "2026-11-07T17:00:00.000Z",
          endsAt: "2026-11-07T18:00:00.000Z",
          locationId: "r1",
        }),
        session({
          id: "starred",
          startsAt: "2026-11-07T17:30:00.000Z",
          endsAt: "2026-11-07T18:30:00.000Z",
          locationId: "r1",
        }),
      ],
      [{ id: "r1", name: "Bayes" }],
      { rsvps: { going: "going" }, bookmarks: ["starred"] },
      {},
      false,
    );
    expect(out.bookmarks[0].conflicts).toMatchObject([
      { role: "going", title: "Chess" },
    ]);
  });
});
