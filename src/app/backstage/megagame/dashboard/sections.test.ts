import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import LevelGrid from "./LevelGrid";
import ConcentrationSection from "./ConcentrationSection";
import { DELETED_PLAYER, type Concentration } from "@/lib/megagame-progress";
import { NO_LEVELS } from "@/lib/megagame-levels";
import ClassesSection from "./ClassesSection";
import type { ClassTable } from "@/lib/megagame-progress";
import TransitionsSection from "./TransitionsSection";
import type { Transitions } from "@/lib/megagame-progress";
import CohortsSection from "./CohortsSection";
import type { CohortTable } from "@/lib/megagame-progress";

describe("LevelGrid", () => {
  it("shows players per level with percentages of ticket holders", () => {
    const html = renderToStaticMarkup(
      createElement(LevelGrid, {
        grid: {
          wizard: [0, 3, 1, 0, 0, 0],
          pirate: [0, 0, 0, 0, 0, 0],
          alien: [0, 2, 0, 0, 0, 0],
        },
        holders: 10,
      }),
    );
    expect(html).toContain("Wizard");
    expect(html).toContain("(30%)");
    expect(html).toContain("(40%)"); // wizard "In class" row: 4 of 10
    expect(html).toContain("of the 10 accounts");
  });

  it("shows a dash instead of a percentage with no holders", () => {
    const html = renderToStaticMarkup(
      createElement(LevelGrid, {
        grid: {
          wizard: [0, 1, 0, 0, 0, 0],
          pirate: [0, 0, 0, 0, 0, 0],
          alien: [0, 0, 0, 0, 0, 0],
        },
        holders: 0,
      }),
    );
    expect(html).toContain("(–)");
  });
});

const summary = (
  players: number,
  total: number,
  top20: number,
  gini: number,
) => ({
  players,
  total,
  top10: top20,
  top20,
  top50: top20,
  gini,
});
const concentrationData: Concentration = {
  completions: summary(4, 7, 3 / 7, 0.25),
  byClass: {
    wizard: summary(3, 4, 0.5, 0.2),
    pirate: summary(2, 2, 0.5, 0),
    alien: summary(0, 0, 0, 0),
  },
  levelUps: summary(2, 3, 2 / 3, 1 / 6),
  lorenz: {
    overall: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
    byClass: { wizard: [], pirate: [], alien: [] },
  },
  series: [
    {
      end: new Date("2026-11-07T08:00:00.000Z"),
      players: 2,
      completions: 3,
      top20: 2 / 3,
      gini: 1 / 6,
    },
  ],
  mostActive: [
    {
      key: DELETED_PLAYER,
      userId: null,
      name: null,
      levels: NO_LEVELS,
      completions: 2,
      byClass: { wizard: 1, pirate: 1, alien: 0 },
      anyClass: 0,
      levelUps: 0,
      firstActivity: new Date("2026-11-06T22:00:00.000Z"),
      lastActivity: new Date("2026-11-06T23:00:00.000Z"),
    },
  ],
};
const renderConcentration = (
  tooMany: boolean,
  ends = [new Date("2026-11-07T08:00:00.000Z")],
  data = concentrationData,
) =>
  renderToStaticMarkup(
    createElement(ConcentrationSection, {
      data,
      ends,
      size: "1d",
      tooMany,
      rangeLabel: "Whole con",
    }),
  );

describe("ConcentrationSection", () => {
  it("shows the headline shares and Gini", () => {
    const html = renderConcentration(false);
    expect(html).toContain("43%");
    expect(html).toContain("0.25");
    expect(html).toContain("67%"); // level-ups top 20%
  });

  it("labels the Lorenz plot and the series chart and keeps their tables", () => {
    const html = renderConcentration(false);
    expect(html).toMatch(/aria-label="[^"]*Lorenz/);
    expect(html).toMatch(/aria-label="Top 20% share and Gini/);
    expect(html).toContain("Fri, Nov 6 (end)");
    expect(html).toContain("0.17");
  });

  it("marks each line with a circle when there is only one bucket", () => {
    const html = renderConcentration(false);
    expect(html.match(/<circle /g)).toHaveLength(2);
  });

  it("labels the series axis from 0 to 1 and says both lines are fractions of 1", () => {
    const html = renderConcentration(false);
    expect(html).not.toContain(">100%<");
    expect(html).toMatch(/<span>1<\/span><span>0<\/span>/);
    expect(html).toContain("both fractions of 1");
  });

  it("does not hide the charts on phones", () => {
    expect(renderConcentration(false)).not.toContain("hidden sm:block");
  });

  it("names deleted accounts in the most-active table", () => {
    expect(renderConcentration(false)).toContain("Deleted account");
  });

  it("replaces the series with the too-many-buckets alert", () => {
    const html = renderConcentration(true, []);
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("Fri, Nov 6 (end)");
  });

  it("shows an empty state with no series chart or end labels when the range has no buckets", () => {
    const html = renderConcentration(false, [], {
      ...concentrationData,
      series: [],
    });
    expect(html).toContain("This range has not started yet");
    expect(html).not.toMatch(/aria-label="Top 20% share and Gini/);
    expect(html).not.toContain("(end)");
    expect(html).not.toContain('role="alert"');
    expect(html).toMatch(/aria-label="[^"]*Lorenz/);
  });
});

const cell = (
  completions: number,
  levelUps: number,
  activePlayers: number,
  memberShare: number | null,
) => ({
  completions,
  levelUps,
  activePlayers,
  memberShare,
});
const classData: ClassTable = {
  members: { wizard: 2, pirate: 1, alien: 0 },
  rows: [
    {
      start: new Date("2026-11-06T08:00:00.000Z"),
      end: new Date("2026-11-07T08:00:00.000Z"),
      byClass: {
        wizard: cell(1, 1, 1, 0.5),
        pirate: cell(1, 0, 1, 1),
        alien: cell(0, 0, 0, null),
      },
      anyClass: 4,
    },
  ],
  totals: {
    byClass: {
      wizard: cell(1, 1, 1, 0.5),
      pirate: cell(1, 0, 1, 1),
      alien: cell(0, 0, 0, null),
    },
    anyClass: 4,
  },
};
const emptyClassData: ClassTable = {
  members: classData.members,
  rows: [],
  totals: {
    byClass: {
      wizard: cell(0, 0, 0, 0),
      pirate: cell(0, 0, 0, 0),
      alien: cell(0, 0, 0, null),
    },
    anyClass: 0,
  },
};
const renderClasses = (tooMany: boolean) =>
  renderToStaticMarkup(
    createElement(ClassesSection, {
      table: classData,
      cumulative: [
        {
          wizard: [0, 3, 1, 0, 0, 0],
          pirate: [0, 1, 0, 0, 0, 0],
          alien: [0, 0, 0, 0, 0, 0],
        },
      ],
      ends: [new Date("2026-11-07T08:00:00.000Z")],
      size: "1d",
      tooMany,
      rangeLabel: "Whole con",
    }),
  );

describe("ClassesSection", () => {
  it("shows a row per bucket and a total row", () => {
    const html = renderClasses(false);
    expect(html).toContain("Fri, Nov 6");
    expect(html).toContain("Total");
    expect(html).toContain("50%"); // wizard: 1 active of 2 members
    expect(html).toContain("100%"); // pirate: 1 active of 1 member
    expect(html).toContain("% of members");
    expect(html).toContain("faction picks do not count");
  });

  it("draws the cumulative bars with a label and a table fallback, also on phones", () => {
    const html = renderClasses(false);
    expect(html).toMatch(/aria-label="Players at each level by class/);
    expect(html).toContain("3 / 1 / 0 / 0 / 0");
    expect(html).not.toContain("hidden sm:block");
  });

  it("shows only the alert when there are too many buckets", () => {
    const html = renderClasses(true);
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("Total");
  });

  it("shows an empty state with no table, bars or end labels when the range has no buckets", () => {
    const html = renderToStaticMarkup(
      createElement(ClassesSection, {
        table: emptyClassData,
        cumulative: [],
        ends: [],
        size: "1d",
        tooMany: false,
        rangeLabel: "Today",
      }),
    );
    expect(html).toContain("This range has not started yet");
    expect(html).not.toMatch(/aria-label="Players at each level by class/);
    expect(html).not.toContain("Total");
    expect(html).not.toContain("(end)");
  });
});

const HOUR = 3_600_000;
const transitionData: Transitions = {
  rows: [
    {
      class: "wizard",
      from: 1,
      to: 2,
      made: 3,
      skipped: 1,
      q25: 3 * HOUR,
      median: 4 * HOUR,
      q75: 5 * HOUR,
    },
    {
      class: "wizard",
      from: 2,
      to: 3,
      made: 0,
      skipped: 0,
      q25: null,
      median: null,
      q75: null,
    },
  ],
  current: [
    {
      class: "wizard",
      level: 2,
      players: 3,
      withEvent: 2,
      medianSince: 5.5 * HOUR,
    },
  ],
};

describe("TransitionsSection", () => {
  it("shows counts, skips and durations, with a dash where nobody made it", () => {
    const html = renderToStaticMarkup(
      createElement(TransitionsSection, { data: transitionData }),
    );
    expect(html).toContain("1 → 2");
    expect(html).toContain("3h 00m");
    expect(html).toContain("4h 00m");
    expect(html).toContain("5h 30m");
    expect(html).toContain("–");
  });

  it("names the first con day in the note from CONFERENCE_DAYS", async () => {
    vi.resetModules();
    vi.doMock("@/lib/schedule", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/schedule")>()),
      CONFERENCE_DAYS: [
        { key: "2027-01-01", name: "Friday", dateLabel: "Jan 1" },
      ],
    }));
    try {
      const { default: Section } = await import("./TransitionsSection");
      const html = renderToStaticMarkup(
        createElement(Section, { data: transitionData }),
      );
      expect(html).toContain("midnight Pacific, Friday Jan 1");
    } finally {
      vi.doUnmock("@/lib/schedule");
      vi.resetModules();
    }
  });
});

const cohortData: CohortTable = {
  days: ["2026-11-06", "2026-11-07", "2026-11-08"],
  rows: [
    {
      day: "2026-11-06",
      size: 2,
      completionsMean: 1,
      completionsMedian: 1,
      levelUpsMean: 0.5,
      reachedLevel2Share: 1,
      retention: [null, 0.5, 0],
    },
  ],
  holders: 4,
  notYetActive: 2,
  notYetActiveShare: 0.5,
};

describe("CohortsSection", () => {
  it("shows each cohort with retention on later days only", () => {
    const html = renderToStaticMarkup(
      createElement(CohortsSection, { data: cohortData }),
    );
    expect(html).toContain("Friday Nov 6");
    expect(html).toContain("Active Saturday Nov 7");
    expect(html).toContain("50%");
    expect(html).toContain("0.5");
    expect(html).toContain("2 of 4 claimed-ticket holders");
  });

  it("says activity before the first con day is its own row and not counted as not yet active", () => {
    const html = renderToStaticMarkup(
      createElement(CohortsSection, { data: cohortData }),
    );
    expect(html).toContain(
      "Activity before the first con day appears as its own cohort row and is not counted as not yet active.",
    );
  });
});
