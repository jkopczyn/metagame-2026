import { describe, expect, it } from "vitest";
import { parseBoardParams } from "../board-params";
import { MAX_BUCKETS, overTimeView, viewHref } from "./view";

const view = (sp: Record<string, string>, at: Date) =>
  overTimeView(parseBoardParams(sp), at);

const now = new Date("2026-11-07T18:07:00.000Z"); // 10:07 AM Pacific, Saturday
const iso = (d: Date) => d.toISOString();

describe("overTimeView", () => {
  it("defaults to today in 30 minute buckets, from Pacific midnight", () => {
    const v = view({}, now);
    expect(v.preset).toBe("today");
    expect(v.size).toBe("30m");
    expect(iso(v.from)).toBe("2026-11-07T08:00:00.000Z");
    expect(iso(v.to)).toBe(iso(now));
    expect(v.buckets).toHaveLength(21);
    expect(iso(v.buckets.at(-1)!)).toBe("2026-11-07T18:00:00.000Z");
    expect(v.tooMany).toBe(false);
  });

  it("aligns the last 2 hours to the bucket containing its start", () => {
    const v = view({ range: "2h" }, now);
    expect(v.size).toBe("5m");
    expect(iso(v.from)).toBe("2026-11-07T16:05:00.000Z");
    expect(v.buckets).toHaveLength(25);
  });

  it("covers the three con days in Pacific time, ending at Monday midnight", () => {
    const after = new Date("2026-11-10T18:00:00.000Z");
    const v = view({ range: "con", bucket: "1d" }, after);
    expect(iso(v.from)).toBe("2026-11-06T08:00:00.000Z");
    expect(iso(v.to)).toBe("2026-11-09T08:00:00.000Z");
    expect(v.buckets.map(iso)).toEqual([
      "2026-11-06T08:00:00.000Z",
      "2026-11-07T08:00:00.000Z",
      "2026-11-08T08:00:00.000Z",
    ]);
  });

  it("ends the whole con range at now while the con is on", () => {
    const v = view({ range: "con", bucket: "1h" }, now);
    expect(iso(v.from)).toBe("2026-11-06T08:00:00.000Z");
    expect(iso(v.to)).toBe(iso(now));
    expect(iso(v.buckets.at(-1)!)).toBe("2026-11-07T18:00:00.000Z");
  });

  it("shows the whole con range before and after the con", () => {
    for (const at of ["2026-11-01T18:00:00.000Z", "2026-11-12T18:00:00.000Z"]) {
      const v = view({ range: "con", bucket: "1d" }, new Date(at));
      expect(iso(v.from)).toBe("2026-11-06T08:00:00.000Z");
      expect(iso(v.to)).toBe("2026-11-09T08:00:00.000Z");
    }
  });

  it("ignores an unknown range or bucket", () => {
    const v = view({ range: "week", bucket: "2h" }, now);
    expect([v.preset, v.size]).toEqual(["today", "30m"]);
  });

  it("flags a range with too many buckets and returns none", () => {
    const v = view({ range: "con", bucket: "5m" }, now);
    expect(v.tooMany).toBe(true);
    expect(v.buckets).toEqual([]);
    expect(MAX_BUCKETS).toBeLessThan(3 * 288);
  });
});

describe("viewHref", () => {
  it("keeps the rest of the board when one choice changes", () => {
    const params = parseBoardParams({
      quest: "A2C4EF",
      players: "u1",
      range: "con",
      bucket: "1h",
    });
    const v = overTimeView(params, now);
    expect(viewHref(params, v, { bucket: "3h" })).toBe(
      "/backstage/megagame?quest=A2C4EF&players=u1&range=con&bucket=3h",
    );
  });

  it("drops the chosen bucket when the range changes, so the new range's default applies", () => {
    const params = parseBoardParams({ range: "con", bucket: "1h" });
    const v = overTimeView(params, now);
    expect(viewHref(params, v, { range: "2h" })).toBe(
      "/backstage/megagame?range=2h",
    );
  });
});
