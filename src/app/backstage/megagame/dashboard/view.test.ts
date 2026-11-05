import { describe, expect, it } from "vitest";
import { EDITOR_DAYS } from "@/lib/schedule";
import { when } from "../format";
import {
  MAX_BUCKETS,
  bucketLabel,
  dashboardView,
  dayLabel,
  decimal,
  endLabel,
  formatDuration,
  percent,
  viewHref,
} from "./view";

const now = new Date("2026-11-07T18:07:00.000Z"); // 10:07 AM Pacific, Saturday
const iso = (d: Date) => d.toISOString();

describe("dashboardView", () => {
  it("defaults to today in 30 minute buckets, from Pacific midnight", () => {
    const v = dashboardView({}, now);
    expect(v.preset).toBe("today");
    expect(v.size).toBe("30m");
    expect(iso(v.from)).toBe("2026-11-07T08:00:00.000Z");
    expect(iso(v.to)).toBe(iso(now));
    expect(v.buckets).toHaveLength(21);
    expect(iso(v.buckets.at(-1)!)).toBe("2026-11-07T18:00:00.000Z");
    expect(v.tooMany).toBe(false);
  });

  it("has no buckets for today at Pacific midnight, without flagging too many", () => {
    const v = dashboardView({}, new Date("2026-11-07T08:00:00.000Z"));
    expect(v.buckets).toEqual([]);
    expect(v.tooMany).toBe(false);
  });

  it("aligns the last 2 hours to the bucket containing its start", () => {
    const v = dashboardView({ range: "2h" }, now);
    expect(v.size).toBe("5m");
    expect(iso(v.from)).toBe("2026-11-07T16:05:00.000Z");
    expect(v.buckets).toHaveLength(25);
  });

  it("covers the three con days in Pacific time, ending at Monday midnight", () => {
    const after = new Date("2026-11-10T18:00:00.000Z");
    const v = dashboardView({ range: "con", bucket: "1d" }, after);
    expect(iso(v.from)).toBe("2026-11-06T08:00:00.000Z");
    expect(iso(v.to)).toBe("2026-11-09T08:00:00.000Z");
    expect(v.buckets.map(iso)).toEqual([
      "2026-11-06T08:00:00.000Z",
      "2026-11-07T08:00:00.000Z",
      "2026-11-08T08:00:00.000Z",
    ]);
  });

  it("ends the whole con range at now while the con is on", () => {
    const v = dashboardView({ range: "con", bucket: "1h" }, now);
    expect(iso(v.from)).toBe("2026-11-06T08:00:00.000Z");
    expect(iso(v.to)).toBe(iso(now));
    expect(iso(v.buckets.at(-1)!)).toBe("2026-11-07T18:00:00.000Z");
  });

  it("shows the whole con range before and after the con", () => {
    for (const at of ["2026-11-01T18:00:00.000Z", "2026-11-12T18:00:00.000Z"]) {
      const v = dashboardView({ range: "con", bucket: "1d" }, new Date(at));
      expect(iso(v.from)).toBe("2026-11-06T08:00:00.000Z");
      expect(iso(v.to)).toBe("2026-11-09T08:00:00.000Z");
    }
  });

  it("ignores an unknown range or bucket and a leftover class parameter", () => {
    const v = dashboardView({ range: "week", bucket: "2h", cls: "bard" }, now);
    expect([v.preset, v.size]).toEqual(["today", "30m"]);
    expect(v).not.toHaveProperty("cls");
  });

  it("takes the first value of a repeated parameter", () => {
    const v = dashboardView({ bucket: ["1h", "5m"] }, now);
    expect(v.size).toBe("1h");
  });

  it("flags a range with too many buckets and returns none", () => {
    const v = dashboardView({ range: "con", bucket: "5m" }, now);
    expect(v.tooMany).toBe(true);
    expect(v.buckets).toEqual([]);
    expect(MAX_BUCKETS).toBeLessThan(3 * 288);
  });
});

describe("viewHref", () => {
  it("keeps the range when the bucket changes", () => {
    const v = dashboardView({ range: "con", bucket: "3h" }, now);
    expect(viewHref(v, { bucket: "1h" })).toBe(
      "/backstage/megagame/dashboard?range=con&bucket=1h",
    );
  });

  it("drops the chosen bucket when the range changes, so the new range's default applies", () => {
    const v = dashboardView({ range: "con", bucket: "1h" }, now);
    expect(viewHref(v, { range: "2h" })).toBe(
      "/backstage/megagame/dashboard?range=2h",
    );
  });

  it("keeps both choices for the sign-in link", () => {
    const v = dashboardView({ range: "con", bucket: "1h" }, now);
    expect(viewHref(v, {})).toBe(
      "/backstage/megagame/dashboard?range=con&bucket=1h",
    );
  });
});

describe("formatters", () => {
  it("formats durations by size", () => {
    expect(formatDuration(null)).toBe("–");
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(45 * 60_000)).toBe("45m");
    expect(formatDuration((3 * 60 + 5) * 60_000)).toBe("3h 05m");
    expect(formatDuration(28 * 3_600_000)).toBe("1d 4h");
  });

  it("formats shares and decimals, with a dash for no value", () => {
    expect(percent(3 / 7)).toBe("43%");
    expect(percent(null)).toBe("–");
    expect(decimal(0.25, 2)).toBe("0.25");
    expect(decimal(1.5)).toBe("1.5");
    expect(decimal(null)).toBe("–");
  });

  it("labels day buckets by Pacific day and other buckets by time", () => {
    const fri = new Date("2026-11-06T08:00:00.000Z");
    expect(bucketLabel(fri, "1d")).toBe("Fri, Nov 6");
    expect(bucketLabel(fri, "1h")).toBe(when(fri));
    expect(endLabel(new Date("2026-11-07T08:00:00.000Z"), "1d")).toBe(
      "Fri, Nov 6 (end)",
    );
  });

  it("names con days and other days the same way", () => {
    expect(dayLabel("2026-11-07")).toBe("Saturday Nov 7");
    expect(dayLabel("2026-11-03")).toBe("Tuesday Nov 3");
    expect(dayLabel("2026-11-05")).toBe("Thursday Nov 5");
    expect(dayLabel("2026-10-31")).toBe("Saturday Oct 31");
    for (const d of EDITOR_DAYS)
      expect(dayLabel(d.key)).toBe(`${d.name} ${d.dateLabel}`);
  });
});
