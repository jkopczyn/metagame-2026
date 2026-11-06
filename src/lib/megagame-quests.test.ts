import { describe, expect, it } from "vitest";
import {
  cardBackground,
  parseQuestInput,
  questInputOf,
  stampList,
} from "./megagame-quests";

const minimal = { title: "Hoot & Seek" };

describe("parseQuestInput", () => {
  it("fills defaults for a title alone", () => {
    expect(parseQuestInput(minimal)).toEqual({
      ok: true,
      input: {
        title: "Hoot & Seek",
        bodyText: "",
        bodyImages: [],
        class: null,
        minLevel: null,
        maxLevel: null,
        minPlayers: 1,
        stamps: { wizard: 0, pirate: 0, alien: 0, any: 0 },
        evidence: null,
        evidenceImage: null,
        hint: null,
        author: null,
        active: true,
      },
    });
  });

  it("takes numbers as strings, as a form sends them, and classes in any case", () => {
    const parsed = parseQuestInput({
      ...minimal,
      class: "Wizard",
      minLevel: "2",
      maxLevel: "",
      minPlayers: " 6 ",
      stamps: { Wizard: "2", any: 1, pirate: "" },
      bodyText: "First\r\n\r\nSecond  ",
      evidence: "  AVIANNA ",
      active: "on",
    });
    expect(parsed).toMatchObject({
      ok: true,
      input: {
        class: "wizard",
        minLevel: 2,
        maxLevel: null,
        minPlayers: 6,
        stamps: { wizard: 2, pirate: 0, alien: 0, any: 1 },
        bodyText: "First\n\nSecond",
        evidence: "AVIANNA",
        active: true,
      },
    });
  });

  it("reads 'any' as no class and a missing active as true, 'false' as false", () => {
    expect(parseQuestInput({ ...minimal, class: "any" })).toMatchObject({
      input: { class: null, active: true },
    });
    expect(parseQuestInput({ ...minimal, active: false })).toMatchObject({
      input: { active: false },
    });
    expect(parseQuestInput({ ...minimal, active: "false" })).toMatchObject({
      input: { active: false },
    });
  });

  it("reports every problem at once", () => {
    const parsed = parseQuestInput({
      title: "",
      class: "druid",
      minLevel: 9,
      minPlayers: 0,
      stamps: { wizard: -1, elf: 2 },
      bodyImages: ["http://insecure.example/a.png", "x", "y", "z"],
      evidenceImage: "ftp://nope",
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors).toEqual([
      "title: required",
      "bodyImages: at most 3 images",
      "bodyImages: not an https URL",
      'class: unknown class "druid"',
      "minLevel: a level from 1 to 5",
      "minPlayers: a number from 1 to 100",
      "stamps.wizard: a number from 0 to 99",
      'stamps: unknown class "elf"',
      "evidenceImage: not an https URL",
    ]);
  });

  it("wants a class for a level window and an ordered window", () => {
    expect(parseQuestInput({ ...minimal, minLevel: 2 })).toMatchObject({
      ok: false,
      errors: ["minLevel/maxLevel: a level window needs a class"],
    });
    expect(
      parseQuestInput({ ...minimal, class: "alien", minLevel: 4, maxLevel: 2 }),
    ).toMatchObject({
      ok: false,
      errors: ["minLevel/maxLevel: the minimum is above the maximum"],
    });
  });

  it("caps text lengths", () => {
    expect(
      parseQuestInput({ title: "x".repeat(121), hint: "h".repeat(501) }),
    ).toMatchObject({
      ok: false,
      errors: ["title: at most 120 characters", "hint: at most 500 characters"],
    });
  });
});

describe("row helpers", () => {
  const row = {
    title: "T",
    bodyText: "",
    bodyImages: [],
    class: "pirate",
    minLevel: 1,
    maxLevel: null,
    minPlayers: 2,
    stampsWizard: 0,
    stampsPirate: 3,
    stampsAlien: 0,
    stampsAny: 1,
    evidence: null,
    evidenceImage: null,
    hint: null,
    author: null,
    active: true,
  };

  it("reads a row back into an input and lists its stamps", () => {
    const input = questInputOf(row);
    expect(input.stamps).toEqual({ wizard: 0, pirate: 3, alien: 0, any: 1 });
    expect(input.class).toBe("pirate");
    expect(stampList(input.stamps)).toEqual([
      { class: "pirate", n: 3 },
      { class: "any", n: 1 },
    ]);
  });

  it("picks the card art from the class, star for any", () => {
    expect(cardBackground(row)).toBe("pirate");
    expect(cardBackground({ class: null })).toBe("star");
    expect(cardBackground({ class: "druid" })).toBe("star");
  });
});
