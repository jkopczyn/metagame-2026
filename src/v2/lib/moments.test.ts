import { describe, expect, it } from "vitest";
import { momentAt } from "./moments";

// Friday opens at 2pm, the other days at 10am; every day runs to midnight.
const slots = (from: number) => {
  const out: number[] = [];
  for (let m = from; m < 24 * 60; m += 30) out.push(m);
  return out;
};
const days = [
  { key: "2026-11-06", slots: slots(14 * 60) },
  { key: "2026-11-07", slots: slots(10 * 60) },
  { key: "2026-11-08", slots: slots(10 * 60) },
];

// November 2026 in Pacific is PST, UTC-8.
const at = (utc: string) => momentAt(days, new Date(utc));

describe("momentAt", () => {
  it("places a time inside the conference on its day", () => {
    expect(at("2026-11-07T23:07:00Z")).toEqual({ day: 1, t: 15 * 60 + 7 });
    expect(at("2026-11-08T18:00:00Z")).toEqual({ day: 2, t: 10 * 60 });
  });

  it("is null before and after the conference", () => {
    expect(at("2026-10-30T19:00:00Z")).toBeNull();
    expect(at("2026-11-06T07:59:00Z")).toBeNull(); // Thu 11:59pm
    expect(at("2026-11-09T08:00:00Z")).toBeNull(); // Mon 12:00am
  });

  it("goes by the Pacific day, not the UTC one", () => {
    // Fri 11:30pm Pacific is already Saturday in UTC.
    expect(at("2026-11-07T07:30:00Z")).toEqual({ day: 0, t: 23 * 60 + 30 });
    // Sun 11:59pm is the last minute of the board.
    expect(at("2026-11-09T07:59:00Z")).toEqual({ day: 2, t: 24 * 60 - 1 });
  });

  it("waits at the opening before a day starts", () => {
    expect(at("2026-11-06T17:00:00Z")).toEqual({ day: 0, t: 14 * 60 }); // Fri 9am
    expect(at("2026-11-07T08:00:00Z")).toEqual({ day: 1, t: 10 * 60 }); // Sat 12am
  });

  it("indexes only the days the board shows", () => {
    const withEmpty = [{ key: "2026-11-05", slots: [] }, ...days];
    expect(momentAt(withEmpty, new Date("2026-11-06T23:00:00Z"))).toEqual({
      day: 0,
      t: 15 * 60,
    });
  });
});
