import { describe, expect, it } from "vitest";
import { polylinePoints, seriesPoints, stackSegments } from "./chart-geometry";

describe("polylinePoints", () => {
  it("maps unit points into the box with y pointing up", () => {
    expect(
      polylinePoints(
        [
          { x: 0, y: 0 },
          { x: 0.5, y: 0.25 },
          { x: 1, y: 1 },
        ],
        100,
        100,
      ),
    ).toBe("0,100 50,75 100,0");
  });

  it("rounds to two decimals", () => {
    expect(polylinePoints([{ x: 1 / 3, y: 0 }], 100, 10)).toBe("33.33,10");
  });
});

describe("seriesPoints", () => {
  it("spreads values evenly and scales by max", () => {
    expect(polylinePoints(seriesPoints([0, 0.5, 1], 1), 600, 120)).toBe(
      "0,120 300,60 600,0",
    );
  });

  it("centres a single value and treats max 0 as zero", () => {
    expect(seriesPoints([0.5], 1)).toEqual([{ x: 0.5, y: 0.5 }]);
    expect(seriesPoints([3], 0)).toEqual([{ x: 0.5, y: 0 }]);
  });
});

describe("stackSegments", () => {
  it("stacks from the bottom", () => {
    expect(stackSegments([2, 1, 0], 4, 100)).toEqual([
      { y: 50, height: 50 },
      { y: 25, height: 25 },
      { y: 25, height: 0 },
    ]);
  });

  it("draws nothing when max is 0", () => {
    expect(stackSegments([0, 0], 0, 100)).toEqual([
      { y: 100, height: 0 },
      { y: 100, height: 0 },
    ]);
  });
});
