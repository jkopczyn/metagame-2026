import { describe, expect, it } from "vitest";
import { viewerSessionIds } from "@/lib/schedule";
import {
  announcePlanChange,
  countsAsMine,
  onPlanChange,
  withPlanChange,
  type PlanChange,
} from "./plan-sync";

describe("announcePlanChange", () => {
  it("reports that nobody heard it when no schedule is mounted", () => {
    expect(announcePlanChange({ sessionId: "a", mine: true })).toBe(false);
  });

  it("hands the change to a mounted schedule until it unmounts", () => {
    const heard: PlanChange[] = [];
    const stop = onPlanChange((c) => heard.push(c));
    const change = { sessionId: "a", mine: true };
    expect(announcePlanChange(change)).toBe(true);
    expect(heard).toEqual([change]);
    stop();
    expect(announcePlanChange(change)).toBe(false);
    expect(heard).toHaveLength(1);
  });
});

describe("withPlanChange", () => {
  it("adds and removes a session", () => {
    expect(withPlanChange(["a"], { sessionId: "b", mine: true })).toEqual([
      "a",
      "b",
    ]);
    expect(withPlanChange(["a", "b"], { sessionId: "a", mine: false })).toEqual(
      ["b"],
    );
  });

  it("returns the same list when nothing changes", () => {
    const ids = ["a"];
    expect(withPlanChange(ids, { sessionId: "a", mine: true })).toBe(ids);
    expect(withPlanChange(ids, { sessionId: "b", mine: false })).toBe(ids);
  });
});

describe("countsAsMine", () => {
  const row = (hosts: string[], shepherd: string | null) => ({
    id: "s",
    hosts: hosts.map((userId) => ({ userId, name: "", email: "" })),
    shepherd: shepherd ? { userId: shepherd, name: "", email: "" } : null,
  });
  const onlySession = (
    session: ReturnType<typeof row>,
    plans: { rsvps: Record<string, "going" | "waitlist">; bookmarks: string[] },
  ) => viewerSessionIds("me", [session], plans).length > 0;

  it.each([
    { status: null, bookmarked: false, hosts: [], shepherd: null },
    { status: "going", bookmarked: false, hosts: [], shepherd: null },
    { status: "waitlist", bookmarked: false, hosts: [], shepherd: null },
    { status: null, bookmarked: true, hosts: [], shepherd: null },
    { status: null, bookmarked: false, hosts: ["me"], shepherd: null },
    { status: null, bookmarked: false, hosts: [], shepherd: "me" },
    { status: null, bookmarked: false, hosts: ["other"], shepherd: "other" },
  ] as const)("agrees with the server's rule: %o", (c) => {
    const session = row([...c.hosts], c.shepherd);
    const server = onlySession(session, {
      rsvps: c.status ? { s: c.status } : {},
      bookmarks: c.bookmarked ? ["s"] : [],
    });
    const own = onlySession(session, { rsvps: {}, bookmarks: [] });
    expect(countsAsMine(c, own)).toBe(server);
  });
});
