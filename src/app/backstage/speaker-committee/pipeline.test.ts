import { describe, expect, it } from "vitest";
import {
  byShepherd,
  compare,
  myCounts,
  stepsOf,
  tabRows,
  TABS,
} from "./pipeline";
import { durationMinutes } from "@/lib/rfp-fields";
import { slotLinkable, type Row } from "@/lib/rfp-pipeline";

const row = (over: Partial<Row>): Row => ({
  id: "00000000-0000-0000-0000-000000000000",
  slug: "a",
  title: "A",
  host: "",
  phase: null,
  placed: false,
  startsAt: null,
  endsAt: null,
  locationId: null,
  status: "draft",
  grader: null,
  graderId: null,
  graderIds: [],
  shepherd: null,
  shepherdId: null,
  verdict: null,
  nextSteps: null,
  speakerTier: null,
  megagameIntegration: null,
  ...over,
});

const tab = (key: string) => TABS.find((t) => t.key === key)!;

const rows = [
  row({ id: "1", phase: null, graderIds: ["ana"] }),
  row({ id: "2", phase: "grading", graderIds: ["ana"], shepherdId: "bo" }),
  row({ id: "3", phase: "grading", graderIds: ["bo"] }),
  row({ id: "4", phase: "grading" }),
  row({ id: "5", phase: "shepherding", shepherdId: "ana" }),
  row({ id: "6", phase: "shepherding" }),
  row({ id: "7", phase: "scheduling", shepherdId: "ana" }),
  row({ id: "8", phase: "scheduling", shepherdId: "bo" }),
  row({ id: "9", phase: "ready", shepherdId: "ana", placed: true }),
  row({ id: "10", phase: "ready", shepherdId: "ana" }),
  row({ id: "11", phase: "scheduling", shepherdId: "ana", placed: true }),
];
const ids = (rs: Row[]) => rs.map((r) => r.id);

describe("tabRows", () => {
  it("splits grading and shepherding by whether anyone is assigned", () => {
    expect(ids(tabRows(rows, tab("unprocessed"), "ana", false))).toEqual(["1"]);
    expect(ids(tabRows(rows, tab("assign-grader"), "ana", false))).toEqual([
      "4",
    ]);
    expect(ids(tabRows(rows, tab("grade"), "ana", false))).toEqual(["2", "3"]);
    expect(ids(tabRows(rows, tab("assign-shepherd"), "ana", false))).toEqual([
      "6",
    ]);
    expect(ids(tabRows(rows, tab("shepherd-meeting"), "ana", false))).toEqual([
      "5",
    ]);
    expect(ids(tabRows(rows, tab("schedule"), "ana", false))).toEqual([
      "7",
      "8",
      "11",
    ]);
    expect(ids(tabRows(rows, tab("done"), "ana", false))).toEqual(["9", "10"]);
    expect(ids(tabRows(rows, tab("all"), "ana", false))).toHaveLength(11);
  });

  it("filters grading tabs by grader and shepherding tabs by shepherd", () => {
    expect(ids(tabRows(rows, tab("grade"), "bo", true))).toEqual(["3"]);
    expect(ids(tabRows(rows, tab("schedule"), "bo", true))).toEqual(["8"]);
    expect(ids(tabRows(rows, tab("shepherd-meeting"), "ana", true))).toEqual([
      "5",
    ]);
  });

  it("treats either role as mine on All", () => {
    expect(ids(tabRows(rows, tab("all"), "bo", true))).toEqual(["2", "3", "8"]);
  });

  it("puts proposals waiting on a verdict email in their own tab", () => {
    const notifying = [
      row({ id: "a", phase: "notifying", graderIds: ["ana"] }),
      row({ id: "b", phase: "notifying", shepherdId: "bo" }),
      row({ id: "c", phase: "deciding", graderIds: ["ana"] }),
    ];
    const emailTab = tab("email-verdict");
    expect(ids(tabRows(notifying, tab("decide"), "ana", false))).toEqual(["c"]);
    expect(ids(tabRows(notifying, emailTab, "ana", false))).toEqual(["a", "b"]);
    expect(ids(tabRows(notifying, emailTab, "ana", true))).toEqual(["a"]);
    expect(ids(tabRows(notifying, emailTab, "bo", true))).toEqual(["b"]);
  });

  it("matches nothing as mine without an account", () => {
    expect(tabRows(rows, tab("all"), null, true)).toEqual([]);
  });
});

describe("myCounts", () => {
  it("counts the viewer's rows per tab, placed or not", () => {
    const counts = myCounts(rows, "ana");
    expect(counts.all).toBe(7);
    expect(counts.grade).toBe(1);
    expect(counts.schedule).toBe(2);
    expect(counts.done).toBe(2);
    expect(counts["assign-grader"]).toBe(0);
  });
});

describe("stepsOf", () => {
  it("orders untriaged first, then pipeline order", () => {
    const steps = stepsOf([
      row({ nextSteps: "6. Add to schedule" }),
      row({ nextSteps: "1. Grade" }),
      row({ nextSteps: null }),
    ]);
    expect(steps).toEqual([null, "1. Grade", "6. Add to schedule"]);
  });
});

describe("compare", () => {
  it("sorts Megagame in option order, blanks last", () => {
    const sorted = (rs: Row[], sort: "megagame") =>
      ids([...rs].sort((a, b) => compare(a, b, sort)));
    expect(
      sorted(
        [
          row({ id: "undecided" }),
          row({ id: "none", megagameIntegration: "No integration" }),
          row({
            id: "premade",
            megagameIntegration: "Include premade puzzle in session",
          }),
          row({ id: "deep", megagameIntegration: "Deep integration" }),
          row({
            id: "puzzle",
            megagameIntegration: "Include puzzle and rewards",
          }),
        ],
        "megagame",
      ),
    ).toEqual(["deep", "puzzle", "premade", "none", "undecided"]);
  });
});

describe("not-scheduling tab", () => {
  it("collects the declined phase, which no other tab shows", () => {
    const declined = [
      ...rows,
      row({ id: "12", phase: "declined" }),
      row({ id: "13", phase: "declined", shepherdId: "ana" }),
    ];
    expect(ids(tabRows(declined, tab("not-scheduling"), "ana", false))).toEqual(
      ["12", "13"],
    );
    // Every other tab leaves it alone, so nothing is double-counted.
    for (const t of TABS) {
      if (t.key === "not-scheduling" || t.key === "all") continue;
      expect(ids(tabRows(declined, t, "ana", false))).not.toContain("12");
    }
  });
});

describe("byShepherd", () => {
  it("groups by name, alphabetically, with unassigned last", () => {
    const groups = byShepherd([
      row({ id: "a", shepherd: "Bo" }),
      row({ id: "b", shepherd: null }),
      row({ id: "c", shepherd: "Ana" }),
      row({ id: "d", shepherd: "Bo" }),
    ]);
    expect(groups.map((g) => g.title)).toEqual(["Ana", "Bo", "No shepherd"]);
    expect(groups.map((g) => ids(g.rows))).toEqual([["c"], ["a", "d"], ["b"]]);
  });

  it("leaves out the unassigned group when everything has a shepherd", () => {
    const groups = byShepherd([row({ id: "a", shepherd: "Ana" })]);
    expect(groups.map((g) => g.title)).toEqual(["Ana"]);
  });
});

describe("compare by scheduled", () => {
  it("orders by start time and sinks the unplaced", () => {
    expect(
      ids(
        [
          row({ id: "none" }),
          row({ id: "late", startsAt: "2026-06-13T20:00:00.000Z" }),
          row({ id: "early", startsAt: "2026-06-12T17:00:00.000Z" }),
        ].sort((a, b) => compare(a, b, "scheduled")),
      ),
    ).toEqual(["early", "late", "none"]);
  });
});

describe("slotLinkable", () => {
  const placed = {
    placed: true,
    startsAt: "2026-06-12T17:00:00.000Z",
    locationId: "room",
  };

  it("links a placed published session", () => {
    expect(slotLinkable(row({ ...placed, status: "published" }), true)).toBe(
      true,
    );
  });

  it("won't link a placed draft, which /schedule would 404", () => {
    expect(slotLinkable(row({ ...placed, status: "draft" }), true)).toBe(false);
  });

  it("won't link anything unplaced, or while the schedule is gated", () => {
    expect(slotLinkable(row({ status: "published" }), true)).toBe(false);
    expect(
      slotLinkable(
        row({ ...placed, locationId: null, status: "published" }),
        true,
      ),
    ).toBe(false);
    expect(slotLinkable(row({ ...placed, status: "published" }), false)).toBe(
      false,
    );
  });
});

describe("durationMinutes", () => {
  it("books whole half hours ending on the passing period", () => {
    expect(durationMinutes("1 hour")).toBe(55);
    expect(durationMinutes("90 minutes")).toBe(85);
    expect(durationMinutes("1.5 hrs")).toBe(85);
    expect(durationMinutes("45 min")).toBe(55);
    expect(durationMinutes("2")).toBe(115);
    expect(durationMinutes("30")).toBe(25);
  });

  it("is null without a number", () => {
    expect(durationMinutes("depends")).toBeNull();
    expect(durationMinutes(undefined)).toBeNull();
  });
});
