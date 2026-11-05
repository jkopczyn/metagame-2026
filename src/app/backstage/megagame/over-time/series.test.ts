import { describe, expect, it } from "vitest";
import { fillSeries } from "./series";

const t = (iso: string) => new Date(iso);

describe("fillSeries", () => {
  const buckets = [
    t("2026-11-07T10:00:00.000Z"),
    t("2026-11-07T11:00:00.000Z"),
  ];

  it("puts each count in its bucket and leaves empty buckets at zero", () => {
    const rows = fillSeries(
      buckets,
      [
        { bucket: t("2026-11-07T11:00:00.000Z"), class: "wizard", n: 2 },
        { bucket: t("2026-11-07T11:00:00.000Z"), class: null, n: 1 },
      ],
      [
        {
          bucket: t("2026-11-07T10:00:00.000Z"),
          class: "pirate",
          source: "volunteer",
          n: 3,
        },
        {
          bucket: t("2026-11-07T10:00:00.000Z"),
          class: "alien",
          source: "picker",
          n: 4,
        },
      ],
    );
    expect(rows[0]).toMatchObject({
      completions: { wizard: 0, pirate: 0, alien: 0, any: 0 },
      completionTotal: 0,
      levelUps: { wizard: 0, pirate: 3, alien: 0 },
      levelUpTotal: 3,
      joins: { wizard: 0, pirate: 0, alien: 4 },
      joinTotal: 4,
    });
    expect(rows[1]).toMatchObject({
      start: buckets[1],
      completions: { wizard: 2, pirate: 0, alien: 0, any: 1 },
      completionTotal: 3,
      levelUpTotal: 0,
    });
  });

  it("drops rows outside the buckets and unknown classes", () => {
    const rows = fillSeries(
      buckets,
      [{ bucket: t("2026-11-07T09:00:00.000Z"), class: "wizard", n: 2 }],
      [
        {
          bucket: t("2026-11-07T10:00:00.000Z"),
          class: "bard",
          source: "volunteer",
          n: 1,
        },
      ],
    );
    expect(rows.map((r) => r.completionTotal + r.levelUpTotal)).toEqual([0, 0]);
  });
});
