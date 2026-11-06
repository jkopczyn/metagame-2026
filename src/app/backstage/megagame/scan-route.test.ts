import { describe, expect, it } from "vitest";
import { routeScan } from "./scan-route";

const both = { quest: true, player: true };

describe("routeScan", () => {
  it("rejects a payload that is not a megagame code", () => {
    expect(routeScan("hello", both)).toEqual({
      message: "That QR code is not a quest label or a badge.",
    });
  });

  it("reads a badge's bare four-digit number as a player", () => {
    expect(routeScan("0042", both)).toEqual({
      kind: "player",
      badgeNumber: 42,
    });
  });

  it("reads a quest label link or a bare six-character code as a quest", () => {
    expect(routeScan("https://example.com/q/a2c-4ef", both)).toEqual({
      kind: "quest",
      code: "A2C4EF",
    });
    expect(routeScan("A2C4EF", both)).toEqual({
      kind: "quest",
      code: "A2C4EF",
    });
    expect(
      routeScan("https://example.com/backstage/megagame/q/A2C4EF", both),
    ).toEqual({ kind: "quest", code: "A2C4EF" });
  });

  it("no longer reads a /p/ link", () => {
    expect(routeScan("https://example.com/p/0042", both)).toEqual({
      message: "That QR code is not a quest label or a badge.",
    });
  });

  it("reports a kind the page has no use for", () => {
    expect(routeScan("0042", { quest: true, player: false })).toEqual({
      message: "That is a player's badge. Scan a quest label.",
    });
    expect(routeScan("/q/A2C4EF", { quest: false, player: true })).toEqual({
      message: "That is a quest label. Scan a player's badge.",
    });
    expect(routeScan("A2C4EF", { quest: false, player: true })).toEqual({
      message: "That is a quest label. Scan a player's badge.",
    });
  });

  it("reads a Quest Board link's quest or player parameter", () => {
    expect(
      routeScan(
        "https://example.com/backstage/megagame?quest=a2c-4ef&players=u1",
        both,
      ),
    ).toEqual({ kind: "quest", code: "A2C4EF" });
    expect(routeScan("/backstage/megagame?player=0042", both)).toEqual({
      kind: "player",
      badgeNumber: 42,
    });
    expect(routeScan("/backstage/megagame?player=b3d5f7", both)).toEqual({
      message: "That QR code is not a quest label or a badge.",
    });
    expect(routeScan("/backstage/megagame?quest=a2c", both)).toEqual({
      message: "That QR code is not a quest label or a badge.",
    });
  });
});
