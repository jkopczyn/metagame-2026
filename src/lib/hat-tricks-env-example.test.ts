import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DECOY_JSON } from "./hat-tricks-decoy.fixture";
import { parseSchedule } from "./hat-tricks-schedule";

const PREFIX = "# HAT_TRICKS_SCHEDULE=";

describe(".env.example", () => {
  const lines = readFileSync(
    path.join(process.cwd(), ".env.example"),
    "utf8",
  ).split("\n");
  const line = lines.find((l) => l.startsWith(PREFIX));

  it("has a commented HAT_TRICKS_SCHEDULE example", () => {
    expect(line).toBeDefined();
  });

  it("uses the decoy weekend, and it parses", () => {
    const value = line?.slice(PREFIX.length) ?? "";
    expect(value).toBe(DECOY_JSON);
    expect(parseSchedule(value)).toHaveLength(23);
  });
});
