import { describe, expect, it } from "vitest";
import { attemptLog } from "./attempt-log";

describe("attemptLog", () => {
  it("takes each new answer once", () => {
    const log = attemptLog();
    expect(log.take("Fire")).toBe(true);
    expect(log.take("Water")).toBe(true);
  });

  it("skips the same answer again, however it is spelled", () => {
    const log = attemptLog();
    expect(log.take("Fire")).toBe(true);
    expect(log.take(" fire! ")).toBe(false);
  });

  it("takes an answer again after a different one", () => {
    const log = attemptLog();
    log.take("Fire");
    log.take("Water");
    expect(log.take("Fire")).toBe(true);
  });

  it("never takes blank input", () => {
    const log = attemptLog();
    expect(log.take("")).toBe(false);
    expect(log.take(" ?! ")).toBe(false);
  });
});
