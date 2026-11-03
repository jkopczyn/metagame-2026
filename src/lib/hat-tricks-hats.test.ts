import { describe, expect, it } from "vitest";
import { HATS, HAT_IDS, hatById, isHatId } from "./hat-tricks-hats";

describe("hat definitions", () => {
  it("lists the six hats in order with their names", () => {
    expect(HATS.map((h) => h.id)).toEqual([...HAT_IDS]);
    expect(HATS.map((h) => h.name)).toEqual([
      "Wizard hat",
      "Alien saucer",
      "Sparkly fuzzy hat",
      "Satin slouch hat",
      "Tricorn",
      "Spiked crown",
    ]);
  });

  it("points each hat at its line art and has no photos yet", () => {
    for (const hat of HATS) {
      expect(hat.art).toBe(`/images/hat-tricks/${hat.id}.svg`);
      expect(hat.photo).toBeUndefined();
    }
  });

  it("recognises hat ids", () => {
    for (const id of HAT_IDS) expect(isHatId(id)).toBe(true);
    expect(isHatId("beanie")).toBe(false);
    expect(isHatId("")).toBe(false);
    expect(isHatId(42)).toBe(false);
    expect(isHatId(undefined)).toBe(false);
  });

  it("looks a hat up by id", () => {
    expect(hatById("crown").name).toBe("Spiked crown");
  });
});
