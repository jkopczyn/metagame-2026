import { describe, expect, it } from "vitest";
import {
  attendeeName,
  checkinState,
  groupByPack,
  packKey,
  parseBadgeInput,
  parseCheckinQuery,
} from "./checkin";

describe("parseCheckinQuery", () => {
  it("reads digits as a badge number and keeps the text", () => {
    expect(parseCheckinQuery(" 0042 ")).toEqual({
      text: "0042",
      code: null,
      badge: 42,
    });
    expect(parseCheckinQuery("7").badge).toBe(7);
    expect(parseCheckinQuery("12345").badge).toBeNull();
  });

  it("reads a six-character code however it was typed", () => {
    expect(parseCheckinQuery("a2c-4ef").code).toBe("A2C4EF");
    expect(parseCheckinQuery("a2c-4ef").badge).toBeNull();
    expect(parseCheckinQuery("Ada").code).toBeNull();
  });

  it("keeps a code-shaped name as text too, since surnames can be six letters", () => {
    expect(parseCheckinQuery("Smiley")).toEqual({
      text: "Smiley",
      code: "SM11EY",
      badge: null,
    });
  });

  it("caps the text", () => {
    expect(parseCheckinQuery("x".repeat(500)).text).toHaveLength(100);
  });
});

describe("checkinState", () => {
  const t = { status: "paid", ownerUserId: null, checkedInAt: null };
  it("derives the four desk states", () => {
    expect(checkinState(t)).toBe("unclaimed");
    expect(checkinState({ ...t, ownerUserId: "u1" })).toBe("claimed");
    expect(
      checkinState({ ...t, ownerUserId: "u1", checkedInAt: new Date() }),
    ).toBe("checkedIn");
    expect(checkinState({ ...t, status: "pending" })).toBe("unpaid");
    expect(checkinState({ ...t, status: "pending", ownerUserId: "u1" })).toBe(
      "unpaid",
    );
  });
});

describe("packs", () => {
  it("finds the pack behind a ticket id", () => {
    expect(packKey("pi_123:ticket:2")).toBe("pi_123");
    expect(packKey("pi_123")).toBeNull();
    expect(packKey("admin:abc")).toBeNull();
  });

  it("groups pack tickets together, in first-seen order", () => {
    const rows = ["pi_a", "pi_p:ticket:1", "pi_b", "pi_p:ticket:2"].map(
      (paymentId) => ({ paymentId }),
    );
    expect(groupByPack(rows)).toEqual([
      { pack: null, tickets: [{ paymentId: "pi_a" }] },
      {
        pack: "pi_p",
        tickets: [
          { paymentId: "pi_p:ticket:1" },
          { paymentId: "pi_p:ticket:2" },
        ],
      },
      { pack: null, tickets: [{ paymentId: "pi_b" }] },
    ]);
  });
});

describe("attendeeName", () => {
  it("prefers the owner, then holder, then purchaser", () => {
    const names = {
      ownerName: "Owen",
      holderName: "Hal",
      purchaserName: "Pat",
      purchaserEmail: "pat@example.com",
    };
    expect(attendeeName(names)).toBe("Owen");
    expect(attendeeName({ ...names, ownerName: null })).toBe("Hal");
    expect(attendeeName({ ...names, ownerName: " ", holderName: null })).toBe(
      "Pat",
    );
    const nobody = { ownerName: null, holderName: null, purchaserName: null };
    expect(attendeeName({ ...nobody, purchaserEmail: "pat@example.com" })).toBe(
      "pat@example.com",
    );
    expect(attendeeName({ ...nobody, purchaserEmail: null })).toBeNull();
  });
});

describe("parseBadgeInput", () => {
  it("distinguishes blank from invalid", () => {
    expect(parseBadgeInput("")).toBeNull();
    expect(parseBadgeInput("  ")).toBeNull();
    expect(parseBadgeInput("0042")).toBe(42);
    expect(parseBadgeInput("42a")).toBeUndefined();
    expect(parseBadgeInput("12345")).toBeUndefined();
  });
});
