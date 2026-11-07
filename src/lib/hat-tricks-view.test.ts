import { describe, expect, it, vi } from "vitest";
import { formatClockTime, formatShiftTime } from "./hat-tricks-format";
import {
  buildHatTricksView,
  previewOverrides,
  type HatTricksView,
} from "./hat-tricks-view";
import { DECOY_JSON } from "./hat-tricks-decoy.fixture";
import { HAT_IDS } from "./hat-tricks-hats";
import type { Steal } from "./hat-tricks-score";

const pacific = (iso: string) => new Date(`${iso}-08:00`);
const at = (hhmm: string) => pacific(`2020-01-01T${hhmm}:00`);

const RAW_SCHEDULE = JSON.stringify([
  {
    start: "2020-01-01T10:00:00-08:00",
    end: "2020-01-01T11:00:00-08:00",
    hats: ["wizard"],
  },
  {
    start: "2020-01-01T11:00:00-08:00",
    end: "2020-01-01T12:00:00-08:00",
    hats: ["crown", "fuzzy"],
  },
  {
    start: "2020-01-01T12:00:00-08:00",
    end: "2020-01-01T13:00:00-08:00",
    hats: ["tricorn"],
  },
  {
    start: "2020-01-01T13:00:00-08:00",
    end: "2020-01-01T14:00:00-08:00",
    hats: ["saucer"],
  },
]);

const WIZARD_STEAL: Steal = {
  hatId: "wizard",
  userId: "u1",
  stolenAt: at("10:05"),
};

const NAMES = new Map([["u1", "Ada"]]);

function build(
  now: Date,
  overrides: {
    rawSchedule?: string | undefined;
    steals?: readonly Steal[];
    names?: ReadonlyMap<string, string>;
    onScheduleError?: (error: unknown) => void;
  } = {},
): HatTricksView {
  return buildHatTricksView({
    rawSchedule:
      "rawSchedule" in overrides ? overrides.rawSchedule : RAW_SCHEDULE,
    steals: overrides.steals ?? [WIZARD_STEAL],
    names: overrides.names ?? NAMES,
    now,
    onScheduleError: overrides.onScheduleError,
  });
}

describe("formatShiftTime", () => {
  it("formats a Pacific instant as a short weekday and time", () => {
    expect(formatShiftTime("2020-01-04T15:45:00-08:00")).toBe("Sat 3:45 PM");
  });

  it("accepts a Date as well as a string", () => {
    expect(formatShiftTime(pacific("2020-01-04T15:45:00"))).toBe("Sat 3:45 PM");
  });

  it("uses plain spaces only", () => {
    const label = formatShiftTime("2020-01-04T15:45:00-08:00");
    expect(label).not.toMatch(/[  ]/);
    expect(label).not.toContain(",");
  });
});

describe("formatClockTime", () => {
  it("adds seconds", () => {
    expect(formatClockTime("2020-01-04T15:45:07-08:00")).toBe("Sat 3:45:07 PM");
  });

  it("uses plain spaces only", () => {
    expect(formatClockTime("2020-01-04T15:45:07-08:00")).not.toMatch(/[  ]/);
  });
});

describe("buildHatTricksView", () => {
  it("reports the server time", () => {
    const view = build(at("10:30"));
    expect(view.nowIso).toBe(at("10:30").toISOString());
    expect(view.nowLabel).toBe(formatClockTime(at("10:30")));
  });

  it("shows the on-shift hat with its art and photo", () => {
    const view = build(at("10:30"));
    expect(view.state.kind).toBe("on");
    if (view.state.kind !== "on") return;
    expect(view.state.hats).toHaveLength(1);
    const [card] = view.state.hats;
    expect(card.id).toBe("wizard");
    expect(card.name).toBe("Wizard hat");
    expect(card.art).toBe("/images/hat-tricks/wizard.svg");
    expect(card.photo).toBe("/images/hat-tricks/wizard.jpg");
    expect(view.state.endsAt).toBe(at("11:00").toISOString());
    expect(view.state.endsAtLabel).toBe("Wed 11:00 AM");
    expect(view.state.nextLine).toBe(
      "The shift after that ends at Wed 12:00 PM",
    );
    expect(view.perHat.map((entry) => entry.id)).toEqual(["wizard"]);
  });

  it("names the following shift's end in the next line", () => {
    const view = build(at("11:30"));
    if (view.state.kind !== "on") throw new Error("expected on");
    expect(view.state.nextLine).toBe(
      "The shift after that ends at Wed 1:00 PM",
    );
    expect(view.perHat.map((entry) => entry.id)).toEqual(["crown", "fuzzy"]);
  });

  it("has no next line in the last shift", () => {
    const view = build(at("13:30"));
    if (view.state.kind !== "on") throw new Error("expected on");
    expect(view.state.nextLine).toBeNull();
  });

  it("keeps hats that are not on shift out of the on-state view", () => {
    const serialized = JSON.stringify(build(at("10:30")));
    for (const secret of [
      "crown",
      "fuzzy",
      "tricorn",
      "saucer",
      "slouch",
      "Spiked crown",
      "Sparkly fuzzy hat",
      "Tricorn",
      "Alien saucer",
      "Satin slouch hat",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("keeps every hat out of the off-state view", () => {
    const view = build(at("09:30"));
    expect(view.state.kind).toBe("off");
    if (view.state.kind !== "off") return;
    expect(view.state.nextStartsAt).toBe(at("10:00").toISOString());
    expect(view.state.nextStartsAtLabel).toBe("Wed 10:00 AM");
    expect(view.perHat).toEqual([]);

    const serialized = JSON.stringify(view);
    for (const secret of [
      "wizard",
      "crown",
      "fuzzy",
      "tricorn",
      "saucer",
      "slouch",
      "Wizard hat",
      "Spiked crown",
      "Sparkly fuzzy hat",
      "Tricorn",
      "Alien saucer",
      "Satin slouch hat",
      "/images/hat-tricks/",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("lists all six hats once the weekend is done", () => {
    const view = build(at("14:00"));
    expect(view.state.kind).toBe("done");
    expect(view.perHat.map((entry) => entry.id)).toEqual([...HAT_IDS]);
    expect(view.perHat.map((entry) => entry.name)).toContain("Spiked crown");
  });

  it("falls back to the standing tricorn when the schedule does not parse", () => {
    const onScheduleError = vi.fn();
    const view = build(at("10:30"), {
      rawSchedule: "notjson",
      onScheduleError,
    });
    expect(onScheduleError).toHaveBeenCalledTimes(1);
    expect(view.state.kind).toBe("standing");
    if (view.state.kind !== "standing") throw new Error("expected standing");
    expect(view.state.hats.map((hat) => hat.id)).toEqual(["tricorn"]);
    expect(view.state.hats[0].name).toBe("Pirate tricorn");
    expect(view.perHat.map((entry) => entry.id)).toEqual(["tricorn"]);
    expect(view.overall).toEqual([
      { rank: 1, userId: "u1", name: "Ada", steals: 1, points: 5 },
    ]);
  });

  it("shows only the standing tricorn when the schedule is unset", () => {
    const onScheduleError = vi.fn();
    const view = build(at("10:30"), {
      rawSchedule: undefined,
      onScheduleError,
    });
    expect(onScheduleError).not.toHaveBeenCalled();
    expect(view.state.kind).toBe("standing");
    if (view.state.kind !== "standing") throw new Error("expected standing");
    expect(view.state.hats.map((hat) => hat.id)).toEqual(["tricorn"]);
    expect(JSON.stringify(view)).not.toContain("wizard");
  });

  it("names the last thief of a hat", () => {
    const view = build(at("10:30"));
    if (view.state.kind !== "on") throw new Error("expected on");
    expect(view.state.hats[0].lastStolen).toEqual({
      name: "Ada",
      atLabel: "Wed 10:05 AM",
    });
  });

  it("has no last thief for a hat nobody has stolen", () => {
    const view = build(at("10:30"), { steals: [] });
    if (view.state.kind !== "on") throw new Error("expected on");
    expect(view.state.hats[0].lastStolen).toBeNull();
  });

  it("ranks the per-hat leaderboard", () => {
    const steals: Steal[] = [
      WIZARD_STEAL,
      { hatId: "wizard", userId: "u2", stolenAt: at("10:40") },
    ];
    const view = build(at("10:50"), {
      steals,
      names: new Map([
        ["u1", "Ada"],
        ["u2", "Bo"],
      ]),
    });
    expect(view.perHat[0].name).toBe("Wizard hat");
    expect(view.perHat[0].rows).toEqual([
      { rank: 1, userId: "u1", name: "Ada", steals: 1, points: 5 },
      { rank: 1, userId: "u2", name: "Bo", steals: 1, points: 5 },
    ]);
  });
});

describe("buildHatTricksView on the decoy weekend", () => {
  const decoy = (now: Date) =>
    buildHatTricksView({
      rawSchedule: DECOY_JSON,
      steals: [
        {
          hatId: "crown",
          userId: "u1",
          stolenAt: pacific("2020-01-03T12:00:00"),
        },
      ],
      names: NAMES,
      now,
    });

  it("is off before the first shift and names no hat", () => {
    const view = decoy(pacific("2020-01-03T13:00:00"));
    expect(view.state.kind).toBe("off");
    if (view.state.kind !== "off") return;
    expect(view.state.nextStartsAtLabel).toBe("Fri 2:00 PM");
    expect(view.perHat).toEqual([]);

    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("wizard");
    expect(serialized).not.toContain("Wizard hat");
  });

  it("reads the short Sunday shifts", () => {
    const view = decoy(pacific("2020-01-05T09:10:00"));
    if (view.state.kind !== "on") throw new Error("expected on");
    expect(view.state.endsAtLabel).toBe("Sun 9:20 AM");
    expect(view.state.nextLine).toBe(
      "The shift after that ends at Sun 9:40 AM",
    );
  });
});

describe("previewOverrides", () => {
  const everything = {
    schedule: RAW_SCHEDULE,
    now: "2020-01-01T10:30:00-08:00",
    steals: JSON.stringify([
      { hatId: "wizard", userId: "u1", stolenAt: "2020-01-01T10:05:00-08:00" },
    ]),
    names: JSON.stringify({ u1: "Ada" }),
  };

  it("is off in production", () => {
    expect(previewOverrides(everything, "production")).toBeNull();
  });

  it("is on in preview and in local development", () => {
    expect(previewOverrides({ schedule: "[]" }, "preview")).toEqual({
      rawSchedule: "[]",
    });
    expect(previewOverrides({ schedule: "[]" }, undefined)).toEqual({
      rawSchedule: "[]",
    });
  });

  it("ignores every parameter without a schedule", () => {
    expect(
      previewOverrides(
        { now: everything.now, steals: everything.steals },
        "preview",
      ),
    ).toBeNull();
  });

  it("returns only the schedule when nothing else is given", () => {
    expect(previewOverrides({ schedule: RAW_SCHEDULE }, "preview")).toEqual({
      rawSchedule: RAW_SCHEDULE,
    });
  });

  it("takes the first value of a repeated parameter", () => {
    expect(
      previewOverrides({ schedule: ["[]", "notjson"] }, "preview"),
    ).toEqual({ rawSchedule: "[]" });
  });

  it("takes a valid now and drops an invalid one", () => {
    expect(previewOverrides(everything, "preview")?.now).toEqual(at("10:30"));
    expect(
      previewOverrides(
        { schedule: RAW_SCHEDULE, now: "not a time" },
        "preview",
      ),
    ).toEqual({ rawSchedule: RAW_SCHEDULE });
  });

  it("parses steals and names", () => {
    const overrides = previewOverrides(everything, "preview");
    expect(overrides?.data).toEqual({
      steals: [{ hatId: "wizard", userId: "u1", stolenAt: at("10:05") }],
      names: new Map([["u1", "Ada"]]),
    });
  });

  it("drops steals with an unknown hat id or an invalid time", () => {
    const steals = JSON.stringify([
      { hatId: "beanie", userId: "u1", stolenAt: "2020-01-01T10:05:00-08:00" },
      { hatId: "wizard", userId: "u2", stolenAt: "whenever" },
      { hatId: "wizard", userId: "u3", stolenAt: "2020-01-01T10:06:00-08:00" },
    ]);
    const overrides = previewOverrides(
      { schedule: RAW_SCHEDULE, steals },
      "preview",
    );
    expect(overrides?.data?.steals).toEqual([
      { hatId: "wizard", userId: "u3", stolenAt: at("10:06") },
    ]);
  });

  it("gives an empty list for malformed steals and an empty map for malformed names", () => {
    const overrides = previewOverrides(
      { schedule: RAW_SCHEDULE, steals: "notjson", names: "notjson" },
      "preview",
    );
    expect(overrides?.data).toEqual({ steals: [], names: new Map() });
  });

  it("gives an empty map when names is missing", () => {
    const overrides = previewOverrides(
      { schedule: RAW_SCHEDULE, steals: everything.steals },
      "preview",
    );
    expect(overrides?.data?.names).toEqual(new Map());
    expect(overrides?.data?.steals).toHaveLength(1);
  });

  it("leaves data unset when no steals parameter is given", () => {
    expect(
      previewOverrides(
        { schedule: RAW_SCHEDULE, names: everything.names },
        "preview",
      )?.data,
    ).toBeUndefined();
  });
});
