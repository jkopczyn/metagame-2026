import { describe, expect, it } from "vitest";
import type { ScheduleLocation, ScheduleSession } from "./schedule";
import {
  profileAccess,
  publicProfileFields,
  PUBLIC_AUDIENCE,
  safeWebsite,
  TEAM_AUDIENCE,
  userSessions,
  websiteLabel,
  withRole,
  type ProfileRow,
  type ProfileViewer,
} from "./user-profile";

const row = (
  over: Partial<ProfileRow["profile"]> = {},
  user = {},
): ProfileRow =>
  ({
    user: {
      id: "u1",
      name: "Ada",
      email: "ada@example.com",
      banned: false,
      role: "user",
      ...user,
    },
    profile: {
      userId: "u1",
      pronouns: "she/her",
      discordHandle: "ada#1",
      bio: "Builds engines.",
      isPublic: true,
      imageUrl: "https://blob.example/ada.png",
      isAdult: true,
      bringingChildren: false,
      shareWithRecruiters: true,
      website: "ada.example",
      ...over,
    },
  }) as ProfileRow;

describe("publicProfileFields", () => {
  it("keeps only the fields the person typed for other people", () => {
    const profile = publicProfileFields(row());
    expect(Object.keys(profile).sort()).toEqual([
      "bio",
      "imageUrl",
      "name",
      "pronouns",
      "userId",
      "website",
    ]);
    const json = JSON.stringify(profile);
    for (const secret of ["ada@example.com", "ada#1", "isAdult", "recruit"])
      expect(json).not.toContain(secret);
  });

  it("never falls back to the email for a blank name", () => {
    expect(publicProfileFields(row({}, { name: "  " })).name).toBe("Someone");
  });

  it("drops an image url that isn't https", () => {
    expect(
      publicProfileFields(row({ imageUrl: "http://x/a.png" })).imageUrl,
    ).toBeNull();
  });

  it("copes with an account that has no profile row", () => {
    expect(
      publicProfileFields({ user: { id: "u1", name: "Ada" }, profile: null }),
    ).toEqual({
      userId: "u1",
      name: "Ada",
      pronouns: null,
      bio: null,
      website: null,
      imageUrl: null,
    });
  });
});

describe("profileAccess", () => {
  const viewer = (over: Partial<ProfileViewer> = {}): ProfileViewer => ({
    signedIn: true,
    self: false,
    canViewAll: false,
    ...over,
  });
  const shown = row();
  const hidden = row({ isPublic: false });

  it("404s the logged out, whatever isPublic says", () => {
    const out = viewer({ signedIn: false });
    expect(profileAccess(shown, out)).toBe("none");
    expect(profileAccess(hidden, out)).toBe("none");
    expect(
      profileAccess(shown, { signedIn: false, self: false, canViewAll: true }),
    ).toBe("none");
  });

  it("shows a profile marked public to any signed-in account", () => {
    expect(profileAccess(shown, viewer())).toBe("shown");
  });

  it("404s a hidden profile for an ordinary signed-in account", () => {
    expect(profileAccess(hidden, viewer())).toBe("none");
    expect(
      profileAccess(
        { user: { id: "u1", name: "Ada" }, profile: null },
        viewer(),
      ),
    ).toBe("none");
  });

  it("lets a profiles.view holder past isPublic, and says so", () => {
    expect(profileAccess(hidden, viewer({ canViewAll: true }))).toBe(
      "team-private",
    );
    expect(profileAccess(shown, viewer({ canViewAll: true }))).toBe("shown");
  });

  it("always gives the owner their own page", () => {
    expect(profileAccess(hidden, viewer({ self: true }))).toBe("own-preview");
    expect(profileAccess(shown, viewer({ self: true }))).toBe("shown");
  });

  it("gives a banned account no page at all", () => {
    const banned = row({}, { banned: true });
    for (const v of [
      viewer(),
      viewer({ self: true }),
      viewer({ canViewAll: true }),
    ])
      expect(profileAccess(banned, v)).toBe("none");
  });
});

describe("safeWebsite", () => {
  it("adds https to a bare host and keeps http(s)", () => {
    expect(safeWebsite("ada.example")).toBe("https://ada.example/");
    expect(safeWebsite(" http://ada.example/games ")).toBe(
      "http://ada.example/games",
    );
  });

  it("drops other schemes and junk", () => {
    expect(safeWebsite("javascript:alert(1)")).toBeNull();
    expect(safeWebsite("data:text/html,x")).toBeNull();
    expect(safeWebsite("   ")).toBeNull();
    expect(safeWebsite(null)).toBeNull();
  });

  it("labels a url without its scheme or trailing slash", () => {
    expect(websiteLabel("https://ada.example/")).toBe("ada.example");
  });
});

const session = (over: Partial<ScheduleSession>): ScheduleSession => ({
  id: "s",
  slug: "s",
  title: "S",
  description: null,
  category: "talk",
  startsAt: "2026-11-07T18:00:00.000Z",
  endsAt: "2026-11-07T18:55:00.000Z",
  locationId: "r1",
  maxCapacity: null,
  minCapacity: null,
  ages: null,
  needs: "a projector",
  status: "published",
  rsvpIsCommitment: false,
  sponsored: false,
  airtableRfpRecordId: "rec1",
  hosts: [],
  shepherd: null,
  ...over,
});

const room = (over: Partial<ScheduleLocation>): ScheduleLocation => ({
  id: "r1",
  name: "Bayes",
  capacity: 40,
  campusLocation: null,
  description: "internal notes",
  displayOrder: 0,
  visibility: "public",
  thumbnailUrl: null,
  imageUrl: null,
  ...over,
});

const ada = { userId: "u1", name: "Ada", email: "ada@example.com" };
const grace = { userId: "u9", name: "Grace", email: "grace@example.com" };

const schedule = {
  locations: [room({}), room({ id: "r2", name: "Turing" }), room({ id: "r3" })],
  sessions: [
    session({ id: "host", slug: "host", hosts: [grace, ada] }),
    session({ id: "shep", slug: "shep", locationId: "r2", shepherd: ada }),
    session({ id: "rsvp", slug: "rsvp", locationId: "r3" }),
    session({ id: "none", slug: "none", hosts: [grace] }),
    session({
      id: "draft",
      slug: "draft",
      status: "draft",
      startsAt: null,
      endsAt: null,
      locationId: null,
      hosts: [ada],
    }),
  ],
};

const plans = { rsvps: { rsvp: "going" as const }, bookmarks: [] };

describe("userSessions", () => {
  it("gives the team every role, drafts included", () => {
    const { sessions } = userSessions("u1", schedule, plans, TEAM_AUDIENCE);
    expect(sessions.map((s) => [s.id, s.roles])).toEqual([
      ["host", ["hosting"]],
      ["shep", ["shepherding"]],
      ["rsvp", ["attending"]],
      ["draft", ["hosting"]],
    ]);
    expect(withRole(sessions, "attending").map((s) => s.rsvp)).toEqual([
      "going",
    ]);
    // Unplaced drafts sort last.
    expect(sessions.at(-1)!.startsAt).toBeNull();
  });

  it("gives the public only published sessions they host", () => {
    const { sessions } = userSessions("u1", schedule, plans, PUBLIC_AUDIENCE);
    expect(sessions.map((s) => s.id)).toEqual(["host"]);
    expect(sessions[0].roles).toEqual(["hosting"]);
  });

  it("ignores RSVPs the audience may not see even when passed", () => {
    const { sessions } = userSessions("u1", schedule, plans, {
      ...PUBLIC_AUDIENCE,
      drafts: true,
    });
    expect(sessions.map((s) => s.id)).not.toContain("rsvp");
    expect(sessions.every((s) => s.rsvp === null)).toBe(true);
  });

  it("marks the lead host apart from a co-host", () => {
    const lead = userSessions("u9", schedule, null, TEAM_AUDIENCE);
    expect(withRole(lead.sessions, "hosting").map((s) => s.lead)).toEqual([
      true,
      true,
    ]);
    const co = userSessions("u1", schedule, null, PUBLIC_AUDIENCE);
    expect(co.sessions[0].lead).toBe(false);
  });

  it("returns only the rooms those sessions use, without internal notes", () => {
    const team = userSessions("u1", schedule, plans, TEAM_AUDIENCE);
    expect(team.locations.map((l) => l.id)).toEqual(["r1", "r2", "r3"]);
    expect(JSON.stringify(team.locations)).not.toContain("internal notes");
    const pub = userSessions("u1", schedule, plans, PUBLIC_AUDIENCE);
    expect(pub.locations.map((l) => l.id)).toEqual(["r1"]);
  });

  it("drops the host email fallback and the committee's own fields", () => {
    const { sessions } = userSessions("u1", schedule, plans, PUBLIC_AUDIENCE);
    const json = JSON.stringify(sessions);
    expect(json).not.toContain("example.com");
    expect(json).not.toContain("a projector");
    expect(json).not.toContain("rec1");
  });

  it("names a host whose account name is blank without their email", () => {
    const blank = {
      ...schedule,
      sessions: [
        session({
          id: "host",
          hosts: [
            { userId: "u1", name: "nameless@x.com", email: "nameless@x.com" },
          ],
        }),
      ],
    };
    const { sessions } = userSessions("u1", blank, null, PUBLIC_AUDIENCE);
    expect(sessions[0].hosts).toEqual([{ name: "Someone" }]);
  });
});

describe("userSessions room visibility", () => {
  // The room the session sits in is team-only; the session itself is published.
  const backstage = {
    locations: [room({ id: "secret", visibility: "hidden" as const })],
    sessions: [
      session({ id: "s", slug: "s", locationId: "secret", hosts: [ada] }),
    ],
  };

  it("hides a team-only room's session from an attendee's view", () => {
    const { sessions, locations } = userSessions(
      "u1",
      backstage,
      null,
      PUBLIC_AUDIENCE,
      "public",
    );
    expect(sessions).toEqual([]);
    expect(locations).toEqual([]);
  });

  it("shows it to the team", () => {
    const { sessions } = userSessions(
      "u1",
      backstage,
      null,
      TEAM_AUDIENCE,
      "team",
    );
    expect(sessions.map((s) => s.id)).toEqual(["s"]);
  });

  it("shows a volunteer room to a volunteer but not an attendee", () => {
    const ops = {
      locations: [room({ id: "ops", visibility: "volunteer" as const })],
      sessions: [
        session({ id: "s", slug: "s", locationId: "ops", hosts: [ada] }),
      ],
    };
    const seen = (viewer: "public" | "volunteer") =>
      userSessions("u1", ops, null, PUBLIC_AUDIENCE, viewer).sessions.length;
    expect(seen("public")).toBe(0);
    expect(seen("volunteer")).toBe(1);
  });

  it("defaults to the attendee view when no viewer is given", () => {
    const { sessions } = userSessions("u1", backstage, null, PUBLIC_AUDIENCE);
    expect(sessions).toEqual([]);
  });

  it("keeps a session with no room at all", () => {
    const { sessions } = userSessions(
      "u1",
      {
        locations: [],
        sessions: [
          session({ id: "s", slug: "s", locationId: null, hosts: [ada] }),
        ],
      },
      null,
      PUBLIC_AUDIENCE,
      "public",
    );
    expect(sessions.map((s) => s.id)).toEqual(["s"]);
  });
});
