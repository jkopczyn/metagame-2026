import { describe, expect, it } from "vitest";
import {
  BOARD,
  RECENT_MAX,
  RECENT_STEP,
  boardHref,
  parseBoardParams,
} from "./board-params";

const C = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";

describe("parseBoardParams", () => {
  it("defaults to an empty board", () => {
    expect(parseBoardParams({})).toEqual({
      quest: null,
      players: [],
      confirmation: null,
      levelUp: null,
      recent: RECENT_STEP,
      range: null,
      bucket: null,
    });
  });

  it("normalizes the quest code and keeps an incomplete one for the message", () => {
    expect(parseBoardParams({ quest: "a2c-4ef" }).quest).toBe("A2C4EF");
    expect(parseBoardParams({ quest: "a2c" }).quest).toBe("A2C");
    expect(parseBoardParams({ quest: " " }).quest).toBeNull();
    expect(parseBoardParams({ quest: ["b3d5f7", "a2c4ef"] }).quest).toBe(
      "B3D5F7",
    );
  });

  it("reads the player list as before", () => {
    expect(parseBoardParams({ players: "u1, u2,u1" }).players).toEqual([
      "u1",
      "u2",
    ]);
  });

  it("keeps a confirmation id only when it is a uuid", () => {
    expect(parseBoardParams({ c: C }).confirmation).toBe(C);
    expect(parseBoardParams({ c: "nope" }).confirmation).toBeNull();
  });

  it("keeps the level-up player id", () => {
    expect(parseBoardParams({ levelup: " u9 " }).levelUp).toBe("u9");
    expect(parseBoardParams({ levelup: "" }).levelUp).toBeNull();
  });

  it("reads the show-more count, clamped to steps between the default and the maximum", () => {
    expect(parseBoardParams({ recent: "60" }).recent).toBe(60);
    expect(parseBoardParams({ recent: "45" }).recent).toBe(60);
    expect(parseBoardParams({ recent: "5" }).recent).toBe(RECENT_STEP);
    expect(parseBoardParams({ recent: "-30" }).recent).toBe(RECENT_STEP);
    expect(parseBoardParams({ recent: "lots" }).recent).toBe(RECENT_STEP);
    expect(parseBoardParams({ recent: "100000" }).recent).toBe(RECENT_MAX);
  });

  it("passes the chart's range and bucket through as given", () => {
    expect(parseBoardParams({ range: "con", bucket: "1h" })).toMatchObject({
      range: "con",
      bucket: "1h",
    });
  });
});

describe("boardHref", () => {
  it("is the bare board for no parameters", () => {
    expect(boardHref({})).toBe(BOARD);
  });

  it("writes every set parameter in a fixed order and leaves defaults out", () => {
    expect(
      boardHref({
        quest: "A2C4EF",
        players: ["u1", "u2"],
        confirmation: C,
        levelUp: "u2",
        recent: 60,
        range: "con",
        bucket: "1h",
      }),
    ).toBe(
      `${BOARD}?quest=A2C4EF&players=u1%2Cu2&c=${C}&levelup=u2&recent=60&range=con&bucket=1h`,
    );
    expect(boardHref({ players: [], recent: RECENT_STEP })).toBe(BOARD);
  });

  it("round-trips through parseBoardParams", () => {
    const params = parseBoardParams({
      quest: "A2C4EF",
      players: "u1",
      c: C,
      recent: "90",
    });
    const query = new URLSearchParams(boardHref(params).split("?")[1]);
    expect(parseBoardParams(Object.fromEntries(query))).toEqual(params);
  });
});
