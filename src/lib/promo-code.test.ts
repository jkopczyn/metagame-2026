import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { promoCode } from "./promo-code";
import * as trackingLinks from "./tracking-links";

describe("promoCode", () => {
  it("keeps a well-formed code, trimmed", () => {
    expect(promoCode("  EARLY_bird-1 ")).toBe("EARLY_bird-1");
  });

  it("rejects anything else as empty", () => {
    for (const bad of [null, undefined, "", "two words", "a!", "x".repeat(101)])
      expect(promoCode(bad)).toBe("");
  });

  it("stays importable from tracking-links for the server callers", () => {
    expect(trackingLinks.promoCode).toBe(promoCode);
  });

  it("imports nothing, so it can't pull server code into the base client bundle", () => {
    const source = readFileSync(new URL("./promo-code.ts", import.meta.url));
    expect(source.toString()).not.toMatch(/^\s*import\b/m);
  });
});
