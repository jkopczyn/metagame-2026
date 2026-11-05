import { describe, expect, it } from "vitest";
import { repeatGate } from "./scan-gate";

describe("repeatGate", () => {
  it("lets a payload through once while the camera keeps seeing it", () => {
    const gate = repeatGate(3000);
    expect(gate.accept("A", 0)).toBe(true);
    expect(gate.accept("A", 500)).toBe(false);
    expect(gate.accept("A", 2900)).toBe(false);
  });

  it("lets the same payload through after it has been out of view for the window", () => {
    const gate = repeatGate(3000);
    gate.accept("A", 0);
    gate.accept("A", 2000);
    expect(gate.accept("A", 4000)).toBe(false);
    expect(gate.accept("A", 7001)).toBe(true);
  });

  it("lets a different payload through at once", () => {
    const gate = repeatGate(3000);
    gate.accept("A", 0);
    expect(gate.accept("B", 100)).toBe(true);
  });

  it("forgets everything on reset", () => {
    const gate = repeatGate(3000);
    gate.accept("A", 0);
    gate.reset();
    expect(gate.accept("A", 10)).toBe(true);
  });
});
