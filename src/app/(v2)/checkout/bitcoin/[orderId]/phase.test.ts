import { describe, expect, it } from "vitest";
import { isFinal, nextPhase, phaseFor } from "./phase";

describe("phaseFor", () => {
  it.each([
    ["paid", "paid"],
    ["processing", "pending"],
    ["unpaid", "pending"],
    ["underpaid", "underpaid"],
    ["expired", "expired"],
    ["refunded", "refunded"],
    ["something-new", "pending"],
  ])("maps %s to %s", (status, phase) => {
    expect(phaseFor(status)).toBe(phase);
  });
});

describe("nextPhase", () => {
  it("shows an error only when there's never been an answer", () => {
    expect(nextPhase("loading", null)).toBe("error");
  });

  it.each(["pending", "paid", "underpaid", "expired", "refunded"] as const)(
    "keeps %s through a failed poll",
    (phase) => {
      expect(nextPhase(phase, null)).toBe(phase);
    },
  );

  it("recovers from an error on the next answer", () => {
    expect(nextPhase("error", "processing")).toBe("pending");
  });

  it("follows the charge when an answer comes", () => {
    expect(nextPhase("pending", "paid")).toBe("paid");
  });
});

describe("isFinal", () => {
  it("stops polling once paid or refunded", () => {
    expect(isFinal("paid")).toBe(true);
    expect(isFinal("refunded")).toBe(true);
  });

  it("keeps polling otherwise", () => {
    expect(isFinal("pending")).toBe(false);
    expect(isFinal("underpaid")).toBe(false);
    expect(isFinal("expired")).toBe(false);
    expect(isFinal("error")).toBe(false);
  });
});
