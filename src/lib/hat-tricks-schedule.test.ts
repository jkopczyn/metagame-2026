import { describe, expect, it } from "vitest";
import {
  ScheduleParseError,
  currentShift,
  nextShift,
  parseSchedule,
  shiftChangesBetween,
  shiftState,
  type Schedule,
} from "./hat-tricks-schedule";
import { DECOY_JSON, type RawShift } from "./hat-tricks-decoy.fixture";
import type { HatId } from "./hat-tricks-hats";

/** A shift on 2020-01-01 at offset -08:00, from "HH:MM" strings. */
function shift(start: string, end: string, hats: HatId[]): RawShift {
  return {
    start: `2020-01-01T${start}:00-08:00`,
    end: `2020-01-01T${end}:00-08:00`,
    hats,
  };
}

const at = (hhmm: string) => new Date(`2020-01-01T${hhmm}:00-08:00`);
const pacific = (iso: string) => new Date(`${iso}-08:00`);

function parsed(...shifts: RawShift[]): Schedule {
  return parseSchedule(JSON.stringify(shifts));
}

describe("parseSchedule", () => {
  it("parses a two-shift value", () => {
    const schedule = parsed(
      shift("10:00", "11:00", ["wizard"]),
      shift("11:00", "12:40", ["crown", "fuzzy"]),
    );
    expect(schedule).toHaveLength(2);
    expect(schedule[0].start.toISOString()).toBe("2020-01-01T18:00:00.000Z");
    expect(schedule[0].end.toISOString()).toBe("2020-01-01T19:00:00.000Z");
    expect(schedule[0].hats).toEqual(["wizard"]);
    expect(schedule[1].end.toISOString()).toBe("2020-01-01T20:40:00.000Z");
    expect(schedule[1].hats).toEqual(["crown", "fuzzy"]);
  });

  it("treats absent and blank values as an empty schedule", () => {
    expect(parseSchedule(undefined)).toEqual([]);
    expect(parseSchedule("")).toEqual([]);
    expect(parseSchedule("   ")).toEqual([]);
    expect(parseSchedule("[]")).toEqual([]);
  });

  it("ignores unknown keys on an entry", () => {
    const raw = JSON.stringify([
      { ...shift("10:00", "11:00", ["wizard"]), note: "ignore me" },
    ]);
    expect(parseSchedule(raw)).toHaveLength(1);
  });

  it("accepts a valid leap day", () => {
    const raw = JSON.stringify([
      {
        start: "2020-02-29T10:00:00-08:00",
        end: "2020-02-29T11:00:00-08:00",
        hats: ["wizard"],
      },
    ]);
    expect(parseSchedule(raw)).toHaveLength(1);
  });

  it("rejects malformed JSON", () => {
    expect(() => parseSchedule("notjson")).toThrow(ScheduleParseError);
  });

  it("rejects a non-array top level", () => {
    expect(() => parseSchedule('{"start":"x"}')).toThrow(ScheduleParseError);
  });

  it("rejects an entry that is not an object", () => {
    expect(() => parseSchedule("[3]")).toThrow(ScheduleParseError);
  });

  it("rejects an unknown hat id and names it", () => {
    const run = () =>
      parsed(shift("10:00", "11:00", ["beanie" as unknown as HatId]));
    expect(run).toThrow(ScheduleParseError);
    expect(run).toThrow(/beanie/);
  });

  it("rejects three hats, no hats, and duplicate hats", () => {
    expect(() =>
      parsed(shift("10:00", "11:00", ["wizard", "crown", "fuzzy"])),
    ).toThrow(ScheduleParseError);
    expect(() => parsed(shift("10:00", "11:00", []))).toThrow(
      ScheduleParseError,
    );
    expect(() => parsed(shift("10:00", "11:00", ["wizard", "wizard"]))).toThrow(
      ScheduleParseError,
    );
  });

  it("rejects overlapping and out-of-order shifts", () => {
    expect(() =>
      parsed(
        shift("10:00", "11:00", ["wizard"]),
        shift("10:30", "12:00", ["crown"]),
      ),
    ).toThrow(ScheduleParseError);
    expect(() =>
      parsed(
        shift("12:00", "13:00", ["wizard"]),
        shift("10:00", "11:00", ["crown"]),
      ),
    ).toThrow(ScheduleParseError);
  });

  it("rejects end equal to start", () => {
    expect(() => parsed(shift("10:00", "10:00", ["wizard"]))).toThrow(
      ScheduleParseError,
    );
  });

  it("rejects timestamps without an offset", () => {
    const raw = JSON.stringify([
      {
        start: "2020-01-01T10:00:00",
        end: "2020-01-01T11:00:00",
        hats: ["wizard"],
      },
    ]);
    expect(() => parseSchedule(raw)).toThrow(ScheduleParseError);
  });

  it("rejects calendar-invalid timestamps and out-of-range offsets", () => {
    const bad = (start: string) =>
      JSON.stringify([
        { start, end: "2020-12-31T11:00:00-08:00", hats: ["wizard"] },
      ]);
    for (const start of [
      "2020-02-30T10:00:00-08:00",
      "2021-02-29T10:00:00-08:00",
      "2020-01-01T25:00:00-08:00",
      "2020-01-01T10:60:00-08:00",
      "2020-01-01T10:00:00+25:00",
    ]) {
      expect(() => parseSchedule(bad(start))).toThrow(ScheduleParseError);
    }
  });

  it("names the failing entry by its 1-based position", () => {
    const raw = JSON.stringify([
      shift("10:00", "11:00", ["wizard"]),
      shift("11:00", "12:00", ["beanie" as unknown as HatId]),
    ]);
    expect(() => parseSchedule(raw)).toThrow(/^shift 2: /);
  });
});

describe("currentShift and nextShift", () => {
  const schedule = parsed(
    shift("10:00", "11:00", ["wizard"]),
    shift("11:00", "12:00", ["crown"]),
    shift("13:00", "14:00", ["fuzzy"]),
  );

  it("finds the shift containing now", () => {
    expect(currentShift(schedule, at("10:30"))?.hats).toEqual(["wizard"]);
  });

  it("returns null in a gap, before the first shift, and after the last", () => {
    expect(currentShift(schedule, at("12:30"))).toBeNull();
    expect(currentShift(schedule, at("09:00"))).toBeNull();
    expect(currentShift(schedule, at("14:30"))).toBeNull();
  });

  it("counts a shift's exact start as current", () => {
    expect(currentShift(schedule, at("10:00"))?.hats).toEqual(["wizard"]);
  });

  it("treats an exact end that is the next start as the next shift", () => {
    expect(currentShift(schedule, at("11:00"))?.hats).toEqual(["crown"]);
  });

  it("returns null at an exact end followed by a gap", () => {
    expect(currentShift(schedule, at("12:00"))).toBeNull();
  });

  it("finds the first shift starting at or after now", () => {
    expect(nextShift(schedule, at("09:00"))?.hats).toEqual(["wizard"]);
    expect(nextShift(schedule, at("12:30"))?.hats).toEqual(["fuzzy"]);
    expect(nextShift(schedule, at("13:00"))?.hats).toEqual(["fuzzy"]);
    expect(nextShift(schedule, at("14:00"))).toBeNull();
  });
});

describe("shiftState", () => {
  const backToBack = parsed(
    shift("10:00", "11:00", ["wizard"]),
    shift("11:00", "12:00", ["crown"]),
  );
  const withGap = parsed(
    shift("10:00", "11:00", ["wizard"]),
    shift("13:00", "14:00", ["crown"]),
  );

  it("is unposted for an empty schedule", () => {
    expect(shiftState([], at("10:30"))).toEqual({ kind: "unposted" });
  });

  it("is on with the next shift back to back", () => {
    expect(shiftState(backToBack, at("10:30"))).toEqual({
      kind: "on",
      hats: ["wizard"],
      endsAt: at("11:00"),
      next: { startsAt: at("11:00"), endsAt: at("12:00") },
    });
  });

  it("is on with the next shift after a gap", () => {
    const state = shiftState(withGap, at("10:30"));
    expect(state.kind).toBe("on");
    if (state.kind !== "on") return;
    expect(state.next).toEqual({ startsAt: at("13:00"), endsAt: at("14:00") });
    expect(state.next?.startsAt.getTime()).not.toBe(state.endsAt.getTime());
  });

  it("is on with no next shift in the last shift", () => {
    const state = shiftState(backToBack, at("11:30"));
    expect(state).toEqual({
      kind: "on",
      hats: ["crown"],
      endsAt: at("12:00"),
      next: null,
    });
  });

  it("is off before the first shift and in a gap", () => {
    expect(shiftState(withGap, at("09:00"))).toEqual({
      kind: "off",
      nextStartsAt: at("10:00"),
    });
    expect(shiftState(withGap, at("12:00"))).toEqual({
      kind: "off",
      nextStartsAt: at("13:00"),
    });
  });

  it("is done at and after the last end", () => {
    expect(shiftState(withGap, at("14:00"))).toEqual({ kind: "done" });
    expect(shiftState(withGap, at("20:00"))).toEqual({ kind: "done" });
  });
});

describe("shiftChangesBetween", () => {
  const schedule = parsed(
    shift("10:00", "11:00", ["wizard"]),
    shift("11:00", "12:00", ["crown"]),
    shift("13:00", "14:00", ["fuzzy"]),
  );

  it("counts a shared instant between back-to-back shifts once", () => {
    expect(
      shiftChangesBetween(schedule, at("10:30"), at("11:30")),
    ).toHaveLength(1);
  });

  it("reports both the end and the next start around a gap", () => {
    expect(shiftChangesBetween(schedule, at("11:30"), at("13:30"))).toEqual([
      at("12:00"),
      at("13:00"),
    ]);
  });

  it("excludes from and includes to by default", () => {
    expect(shiftChangesBetween(schedule, at("10:00"), at("12:00"))).toEqual([
      at("11:00"),
      at("12:00"),
    ]);
  });

  it("can close from and open to", () => {
    expect(
      shiftChangesBetween(schedule, at("10:00"), at("12:00"), {
        from: "closed",
        to: "open",
      }),
    ).toEqual([at("10:00"), at("11:00")]);
  });

  it("can close both ends", () => {
    expect(
      shiftChangesBetween(schedule, at("10:00"), at("12:00"), {
        from: "closed",
        to: "closed",
      }),
    ).toEqual([at("10:00"), at("11:00"), at("12:00")]);
  });

  it("returns nothing when from is after to or the schedule is empty", () => {
    expect(shiftChangesBetween(schedule, at("13:00"), at("11:00"))).toEqual([]);
    expect(shiftChangesBetween([], at("10:00"), at("20:00"))).toEqual([]);
  });
});

describe("the decoy weekend", () => {
  const schedule = parseSchedule(DECOY_JSON);

  it("parses to 23 shifts", () => {
    expect(schedule).toHaveLength(23);
  });

  it("has 26 shift changes across the weekend", () => {
    expect(
      shiftChangesBetween(
        schedule,
        pacific("2020-01-03T13:00:00"),
        pacific("2020-01-05T13:00:00"),
      ),
    ).toHaveLength(26);
  });

  it("is on the overnight shift at Sat 03:00, with a gap before the next", () => {
    const state = shiftState(schedule, pacific("2020-01-04T03:00:00"));
    expect(state.kind).toBe("on");
    if (state.kind !== "on") return;
    expect(state.endsAt).toEqual(pacific("2020-01-04T04:00:00"));
    expect(state.next?.startsAt).toEqual(pacific("2020-01-04T08:00:00"));
  });

  it("is off in the Saturday morning gap", () => {
    expect(shiftState(schedule, pacific("2020-01-04T05:00:00"))).toEqual({
      kind: "off",
      nextStartsAt: pacific("2020-01-04T08:00:00"),
    });
  });

  it("is on the last shift at Sun 12:50 and done at Sun 13:00", () => {
    const state = shiftState(schedule, pacific("2020-01-05T12:50:00"));
    expect(state.kind).toBe("on");
    if (state.kind !== "on") return;
    expect(state.next).toBeNull();
    expect(shiftState(schedule, pacific("2020-01-05T13:00:00"))).toEqual({
      kind: "done",
    });
  });

  it("rotates the hats and puts two hats on every third shift", () => {
    expect(schedule[0].hats).toEqual(["wizard"]);
    expect(schedule[2].hats).toEqual(["fuzzy", "crown"]);
    expect(schedule[3].hats).toEqual(["slouch"]);
  });
});
