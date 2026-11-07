import { is, SQL, StringChunk } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { HAT_IDS } from "../../lib/hat-tricks-hats";
import { hatSteals } from "./hat-tricks";

const config = getTableConfig(hatSteals);

// Renders a SQL expression's literal text, descending into nested SQL
// (sql.raw) chunks.
function flatten(value: unknown): string {
  if (is(value, SQL)) return value.queryChunks.map(flatten).join("");
  if (is(value, StringChunk)) return value.value.join("");
  return "";
}

describe("hatSteals", () => {
  it("is the hat_steals table with the expected columns", () => {
    expect(config.name).toBe("hat_steals");
    expect(config.columns.map((c) => c.name)).toEqual([
      "id",
      "hatId",
      "userId",
      "stolenAt",
      "recordedBy",
      "createdAt",
    ]);
  });

  it("indexes hat_id with stolen_at for per-hat lookups", () => {
    expect(config.indexes).toHaveLength(1);
    const index = config.indexes[0];
    expect(index.config.name).toBe("hat_steals_hat_stolen_at_idx");
    expect(index.config.unique).toBe(false);
  });

  it("constrains hat_id to the known hat ids", () => {
    expect(config.checks).toHaveLength(1);
    const check = config.checks[0];
    expect(check.name).toBe("hat_steals_hat_id_known");
    const text = flatten(check.value);
    for (const id of HAT_IDS) expect(text).toContain(`'${id}'`);
    expect(text.match(/'/g)).toHaveLength(HAT_IDS.length * 2);
  });

  it("has no updatedAt column", () => {
    expect(config.columns.map((c) => c.name)).not.toContain("updatedAt");
  });
});
