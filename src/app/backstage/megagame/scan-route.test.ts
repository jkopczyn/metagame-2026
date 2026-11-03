import { describe, expect, it } from "vitest";
import { routeScan } from "./scan-route";

const both = { quest: true, player: true };

describe("routeScan", () => {
  it("rejects a payload that is not a megagame code", () => {
    expect(routeScan("hello", "player", both)).toEqual({
      message: "That QR code is not a quest label or a badge.",
    });
  });

  it("treats a bare code as the scanner's own kind", () => {
    expect(routeScan("A2C4EF", "player", both)).toEqual({
      kind: "player",
      code: "A2C4EF",
    });
    expect(routeScan("A2C4EF", "quest", both)).toEqual({
      kind: "quest",
      code: "A2C4EF",
    });
  });

  it("follows the kind a link names over the scanner's own", () => {
    expect(
      routeScan(
        "https://example.com/backstage/megagame/q/A2C4EF",
        "player",
        both,
      ),
    ).toEqual({ kind: "quest", code: "A2C4EF" });
  });

  it("reports a kind the page has no use for", () => {
    expect(
      routeScan("/backstage/megagame/p/A2C4EF", "quest", {
        quest: true,
        player: false,
      }),
    ).toEqual({ message: "That is a player's badge. Scan a quest label." });
    expect(
      routeScan("/backstage/megagame/q/A2C4EF", "player", {
        quest: false,
        player: true,
      }),
    ).toEqual({ message: "That is a quest label. Scan a player's badge." });
  });

  it("reads a Quest Board link's quest or player parameter", () => {
    expect(
      routeScan(
        "https://example.com/backstage/megagame?quest=a2c-4ef&players=u1",
        "player",
        both,
      ),
    ).toEqual({ kind: "quest", code: "A2C4EF" });
    expect(
      routeScan("/backstage/megagame?player=b3d5f7", "quest", both),
    ).toEqual({ kind: "player", code: "B3D5F7" });
    expect(routeScan("/backstage/megagame?quest=a2c", "player", both)).toEqual({
      message: "That QR code is not a quest label or a badge.",
    });
  });
});
