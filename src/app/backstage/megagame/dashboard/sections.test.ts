import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import LevelGrid from "./LevelGrid";
import ConcentrationSection from "./ConcentrationSection";
import { DELETED_PLAYER, type Concentration } from "@/lib/megagame-progress";
import { NO_LEVELS } from "@/lib/megagame-levels";

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
