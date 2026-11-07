import { describe, expect, it } from "vitest";
import {
  buildDays,
  cellSessions,
  hostedSessions,
  linkedSession,
  NO_ROOM,
  onGuestList,
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
  rsvpsOpen: true,
  inviteEmails: null,
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
  boardStartsAt: null,
  boardEndsAt: null,
  thumbnailUrl: null,
  imageUrl: null,
  ...over,
});

describe("summarizeRsvps", () => {
  const ada = { userId: "u-ada", name: "Ada" };
  const grace = { userId: "u-grace", name: "Grace" };
  const alan = { userId: "u-alan", name: "Alan" };
  const rows = [
    { status: "going" as const, ...ada },
    { status: "waitlist" as const, ...grace },
    { status: "going" as const, ...alan },
  ];

  it("gives names, in order, when allowed", () => {
    expect(summarizeRsvps(rows, true)).toEqual({
      going: 2,
      waitlist: 1,
      names: { going: [ada, alan], waitlist: [grace] },
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
      locations: [room({ id: "r" })],
      sessions: [
        session({ id: "pub", locationId: "r" }),
        session({ id: "draft", locationId: "r", status: "draft" }),
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
    expect(sessions[0].hosts).toEqual([{ userId: "u1", name: "Ada" }]);
  });

  it("carries the commitment, sponsor and RSVPs-open flags", () => {
    const { sessions } = publicSchedule({
      locations: [room({ id: "r" })],
      sessions: [
        session({
          locationId: "r",
          rsvpIsCommitment: true,
          sponsored: true,
          rsvpsOpen: false,
        }),
      ],
    });
    expect(sessions[0]).toMatchObject({
      rsvpIsCommitment: true,
      sponsored: true,
      rsvpsOpen: false,
    });
  });

  it("says a session is invite-only without sending the guest list", () => {
    const { sessions } = publicSchedule({
      locations: [room({ id: "r" })],
      sessions: [
        session({
          id: "a",
          locationId: "r",
          inviteEmails: ["vip@example.com"],
        }),
        session({ id: "b", locationId: "r" }),
      ],
    });
    expect(sessions.map((s) => s.inviteOnly)).toEqual([true, false]);
    expect(JSON.stringify(sessions)).not.toContain("vip@example.com");
  });

  it("does not show a nameless host's email as their name", () => {
    const { sessions } = publicSchedule({
      locations: [room({ id: "r" })],
      sessions: [
        session({
          locationId: "r",
          hosts: [
            { userId: "u2", name: "bob@example.com", email: "bob@example.com" },
          ],
        }),
      ],
    });
    expect(sessions[0].hosts).toEqual([{ userId: "u2", name: "Someone" }]);
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
    expect(sessions.map((s) => s.id)).toEqual(["a"]);
  });

  it("gives volunteers the volunteer rooms too, but not the hidden one", () => {
    const { locations, sessions } = publicSchedule(levels, "volunteer");
    expect(locations.map((l) => l.id)).toEqual(["open", "ops"]);
    expect(sessions.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("drops a roomless session even for the team", () => {
    const { sessions } = publicSchedule(levels, "team");
    expect(sessions.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("gives the team every room, used or not", () => {
    const { locations } = publicSchedule(levels, "team");
    expect(locations.map((l) => l.id)).toEqual(["open", "ops", "backstage"]);
  });
});

describe("linkedSession", () => {
  const raw = {
    locations: [
      room({ id: "open" }),
      room({ id: "garden", visibility: "unlisted" }),
      room({ id: "backstage", visibility: "hidden" }),
    ],
    sessions: [
      session({ id: "a", slug: "a", locationId: "open" }),
      session({ id: "dinner", slug: "dinner", locationId: "garden" }),
      session({
        id: "draft",
        slug: "draft",
        locationId: "garden",
        status: "draft",
      }),
      session({ id: "secret", slug: "secret", locationId: "backstage" }),
    ],
  };

  it("keeps unlisted rooms off the schedule for everyone but the team", () => {
    for (const viewer of ["public", "volunteer"] as const) {
      const { locations, sessions } = publicSchedule(raw, viewer);
      expect(locations.map((l) => l.id)).toEqual(["open"]);
      expect(sessions.map((s) => s.id)).toEqual(["a"]);
    }
  });

  it("opens a published session in an unlisted room by its slug", () => {
    const found = linkedSession(raw, "dinner");
    expect(found?.session.id).toBe("dinner");
    expect(found?.room.id).toBe("garden");
    expect(JSON.stringify(found)).not.toMatch(/ada@|internal notes|Grace/);
  });

  it("opens nothing in a hidden room, a draft, or a listed room", () => {
    expect(linkedSession(raw, "secret")).toBeNull();
    expect(linkedSession(raw, "draft")).toBeNull();
    expect(linkedSession(raw, "a")).toBeNull();
    expect(linkedSession(raw, "nope")).toBeNull();
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

describe("hostedSessions", () => {
  const ada = { userId: "u1", name: "Ada", email: "ada@example.com" };
  const grace = { userId: "u9", name: "Grace", email: "grace@example.com" };
  const raw = {
    sessions: [
      session({
        id: "a",
        slug: "a",
        title: "A",
        locationId: "r",
        hosts: [ada],
      }),
      session({
        id: "b",
        slug: "b",
        title: "B",
        locationId: "r",
        hosts: [grace, ada],
      }),
      session({
        id: "c",
        slug: "c",
        title: "C",
        locationId: "r",
        hosts: [ada],
        status: "draft",
      }),
    ],
  };
  const shown = publicSchedule({ locations: [room({ id: "r" })], ...raw });

  it("lists the shown sessions each account hosts, in order", () => {
    const got = hostedSessions(raw, shown);
    expect(got.get("u1")?.map((s) => s.slug)).toEqual(["a", "b"]);
    expect(got.get("u9")?.map((s) => s.slug)).toEqual(["b"]);
    expect(got.get("u0")).toBeUndefined();
  });
});

describe("onGuestList", () => {
  it("lets anyone in when there's no list", () => {
    expect(onGuestList(null, "anyone@example.com")).toBe(true);
  });
  it("matches the account's email whatever its case", () => {
    expect(onGuestList(["ada@example.com"], " Ada@Example.com")).toBe(true);
    expect(onGuestList(["ada@example.com"], "grace@example.com")).toBe(false);
    expect(onGuestList([], "ada@example.com")).toBe(false);
  });
});
