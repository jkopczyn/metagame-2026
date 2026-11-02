import { describe, expect, it } from "vitest";
import {
  buildDays,
  cellSessions,
  NO_ROOM,
  onlySessions,
  publicSchedule,
  summarizeRsvps,
  viewerSessionIds,
  type ScheduleLocation,
  type ScheduleSession,
} from "./schedule";

const session = (over: Partial<ScheduleSession>): ScheduleSession => ({
  id: "s",
  slug: "s",
  title: "S",
  description: null,
  category: null,
  startsAt: "2026-11-07T18:00:00.000Z",
  endsAt: "2026-11-07T18:55:00.000Z",
  locationId: null,
  maxCapacity: null,
  minCapacity: null,
  ages: null,
  needs: "a projector",
  status: "published",
  rsvpIsCommitment: false,
  sponsored: false,
  airtableRfpRecordId: "rec1",
  hosts: [{ userId: "u1", name: "Ada", email: "ada@example.com" }],
  shepherd: { userId: "u9", name: "Grace", email: "grace@example.com" },
  ...over,
});

const room = (over: Partial<ScheduleLocation>): ScheduleLocation => ({
  id: "r",
  name: "R",
  capacity: null,
  campusLocation: null,
  description: "internal notes",
  displayOrder: 0,
  visibility: "public",
  thumbnailUrl: null,
  imageUrl: null,
  ...over,
});

describe("summarizeRsvps", () => {
  const rows = [
    { status: "going" as const, name: "Ada" },
    { status: "waitlist" as const, name: "Grace" },
    { status: "going" as const, name: "Alan" },
  ];

  it("gives names, in order, when allowed", () => {
    expect(summarizeRsvps(rows, true)).toEqual({
      going: 2,
      waitlist: 1,
      names: { going: ["Ada", "Alan"], waitlist: ["Grace"] },
    });
  });

  it("gives counts and no names otherwise", () => {
    const summary = summarizeRsvps(rows, false);
    expect(summary).toEqual({ going: 2, waitlist: 1, names: null });
    expect(JSON.stringify(summary)).not.toMatch(/Ada|Alan|Grace/);
  });
});

describe("publicSchedule", () => {
  it("keeps only published, placed sessions and drops private fields", () => {
    const { sessions } = publicSchedule({
      locations: [],
      sessions: [
        session({ id: "pub" }),
        session({ id: "draft", status: "draft" }),
        session({
          id: "unplaced",
          status: "draft",
          startsAt: null,
          endsAt: null,
        }),
      ],
    });
    expect(sessions.map((s) => s.id)).toEqual(["pub"]);
    const json = JSON.stringify(sessions);
    expect(json).not.toContain("ada@example.com");
    expect(json).not.toContain("a projector");
    expect(json).not.toContain("rec1");
    expect(json).not.toContain("Grace");
    expect(json).not.toContain("u9");
    expect(sessions[0].hosts).toEqual([{ name: "Ada" }]);
  });

  it("carries the commitment and sponsor flags", () => {
    const { sessions } = publicSchedule({
      locations: [],
      sessions: [session({ rsvpIsCommitment: true, sponsored: true })],
    });
    expect(sessions[0]).toMatchObject({
      rsvpIsCommitment: true,
      sponsored: true,
    });
  });

  it("does not show a nameless host's email as their name", () => {
    const { sessions } = publicSchedule({
      locations: [],
      sessions: [
        session({
          hosts: [
            { userId: "u2", name: "bob@example.com", email: "bob@example.com" },
          ],
        }),
      ],
    });
    expect(sessions[0].hosts).toEqual([{ name: "Someone" }]);
  });

  it("shows only public rooms, even one holding a published session", () => {
    const { locations, sessions } = publicSchedule({
      locations: [
        room({ id: "shown" }),
        room({ id: "hidden", visibility: "hidden" }),
        room({ id: "used", visibility: "hidden" }),
      ],
      sessions: [
        session({ id: "a", locationId: "used" }),
        session({ id: "b", locationId: "hidden", status: "draft" }),
      ],
    });
    expect(locations.map((l) => l.id)).toEqual(["shown"]);
    // The session goes with the room it sat in, rather than the room being
    // dragged into view to carry it.
    expect(sessions.map((s) => s.id)).toEqual([]);
    expect(JSON.stringify(locations)).not.toContain("internal notes");
  });

  it("still shows a team-only room to the team", () => {
    const { locations } = publicSchedule(
      {
        locations: [room({ id: "backstage", visibility: "hidden" })],
        sessions: [session({ id: "a", locationId: "backstage" })],
      },
      "team",
    );
    expect(locations.map((l) => l.id)).toEqual(["backstage"]);
  });

  const levels = {
    locations: [
      room({ id: "open" }),
      room({ id: "ops", visibility: "volunteer" }),
      room({ id: "backstage", visibility: "hidden" }),
    ],
    sessions: [
      session({ id: "a", slug: "a", locationId: "open" }),
      session({ id: "b", slug: "b", locationId: "ops" }),
      session({ id: "c", slug: "c", locationId: null }),
    ],
  };

  it("keeps volunteer rooms and their sessions from the public", () => {
    const { locations, sessions } = publicSchedule(levels);
    expect(locations.map((l) => l.id)).toEqual(["open"]);
    expect(sessions.map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("gives volunteers the volunteer rooms too, but not the hidden one", () => {
    const { locations, sessions } = publicSchedule(levels, "volunteer");
    expect(locations.map((l) => l.id)).toEqual(["open", "ops"]);
    expect(sessions.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("gives the team every room, used or not", () => {
    const { locations } = publicSchedule(levels, "team");
    expect(locations.map((l) => l.id)).toEqual(["open", "ops", "backstage"]);
  });
});

describe("cellSessions", () => {
  it("picks sessions by column and starting slot, roomless in NO_ROOM", () => {
    const [, saturday] = buildDays([
      session({ id: "in-r", locationId: "r" }),
      session({ id: "no-room" }),
      session({
        id: "later",
        locationId: "r",
        startsAt: "2026-11-07T19:00:00.000Z",
        endsAt: "2026-11-07T19:55:00.000Z",
      }),
    ]);
    // 18:00Z is 10:00 Pacific.
    const ids = (col: string) =>
      cellSessions(saturday.sessions, col, 600).map((s) => s.id);
    expect(ids("r")).toEqual(["in-r"]);
    expect(ids(NO_ROOM)).toEqual(["no-room"]);
  });
});

describe("viewerSessionIds", () => {
  const sessions = [
    session({ id: "hosting" }),
    session({
      id: "cohost",
      hosts: [
        { userId: "u2", name: "Bo", email: "bo@example.com" },
        { userId: "u1", name: "Ada", email: "ada@example.com" },
      ],
    }),
    session({
      id: "shepherding",
      hosts: [],
      shepherd: { userId: "u1", name: "Ada", email: "ada@example.com" },
    }),
    session({ id: "going", hosts: [], shepherd: null }),
    session({ id: "waitlist", hosts: [], shepherd: null }),
    session({ id: "bookmarked", hosts: [], shepherd: null }),
    session({ id: "other", hosts: [], shepherd: null }),
  ];
  const plans = {
    rsvps: { going: "going", waitlist: "waitlist", gone: "going" } as const,
    bookmarks: ["bookmarked", "gone"],
  };

  it("takes hosting, shepherding, RSVPs and bookmarks", () => {
    expect(viewerSessionIds("u1", sessions, plans)).toEqual([
      "hosting",
      "cohost",
      "shepherding",
      "going",
      "waitlist",
      "bookmarked",
    ]);
  });

  it("only returns sessions it was given", () => {
    expect(viewerSessionIds("u3", sessions, plans)).not.toContain("gone");
  });

  it("is empty for someone with no plans", () => {
    expect(
      viewerSessionIds("u3", sessions, { rsvps: {}, bookmarks: [] }),
    ).toEqual([]);
  });
});

describe("onlySessions", () => {
  it("keeps every day and its slots, with only the given sessions", () => {
    const days = buildDays([
      session({ id: "a", startsAt: "2026-11-07T18:00:00.000Z" }),
      session({ id: "b", startsAt: "2026-11-07T19:00:00.000Z" }),
      session({ id: "c", startsAt: "2026-11-08T18:00:00.000Z" }),
    ]);
    const kept = onlySessions(days, new Set(["b"]));
    expect(kept.map((d) => d.key)).toEqual(days.map((d) => d.key));
    expect(kept.map((d) => d.slots)).toEqual(days.map((d) => d.slots));
    expect(kept.flatMap((d) => d.sessions.map((s) => s.id))).toEqual(["b"]);
  });
});
