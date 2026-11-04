import { describe, expect, it } from "vitest";
import { isDayPassOnSale } from "./event-clock";
import { dayPasses } from "./tickets";

const openAt = (iso: string) =>
  dayPasses.filter((p) => isDayPassOnSale(p, new Date(iso))).map((p) => p.id);

describe("isDayPassOnSale", () => {
  it("sells every day before the event", () => {
    expect(openAt("2026-11-04T20:00:00Z")).toEqual([
      "friday",
      "saturday",
      "sunday",
    ]);
  });

  it("keeps a pass on sale for the whole of its Pacific day", () => {
    // 8pm Friday Pacific is already Saturday in UTC.
    expect(openAt("2026-11-07T04:00:00Z")).toContain("friday");
  });

  it.each([
    [
      "2026-11-07T07:59:59.999Z",
      "2026-11-07T08:00:00Z",
      ["friday", "saturday", "sunday"],
      ["saturday", "sunday"],
    ],
    [
      "2026-11-08T07:59:59.999Z",
      "2026-11-08T08:00:00Z",
      ["saturday", "sunday"],
      ["sunday"],
    ],
    ["2026-11-09T07:59:59.999Z", "2026-11-09T08:00:00Z", ["sunday"], []],
  ])("turns over at Pacific midnight (%s)", (before, after, was, now) => {
    expect(openAt(before)).toEqual(was);
    expect(openAt(after)).toEqual(now);
  });
});
