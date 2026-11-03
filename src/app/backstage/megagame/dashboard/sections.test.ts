import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import LevelGrid from "./LevelGrid";

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
