import { describe, expect, it } from "vitest";
import {
  parseHostSessionFields,
  parseLocationFields,
  parseSessionFields,
  type Parsed,
} from "./schedule-input";
import { endMinutes, wallAt } from "./schedule";

/** The field an invalid parse blames, or null when it passed. */
const blamed = (parsed: Parsed<unknown>) => (parsed.ok ? null : parsed.field);

describe("parseSessionFields", () => {
  it("accepts a placed session from JSON, with numbers as numbers", () => {
    const parsed = parseSessionFields({
      title: "Giant chess",
      startsAt: "2026-11-06T18:30",
      endsAt: "2026-11-06T19:55",
      maxCapacity: 20,
      status: "published",
      category: "game",
      ages: "kids",
    });
    if (!parsed.ok) throw new Error(parsed.error);
    const v = parsed.value;
    expect(v.slug).toBe("giant-chess");
    // 18:30 PST is 02:30 UTC the next day.
    expect(v.startsAt?.toISOString()).toBe("2026-11-07T02:30:00.000Z");
    expect(v.endsAt?.toISOString()).toBe("2026-11-07T03:55:00.000Z");
    expect(v.maxCapacity).toBe(20);
    expect(v.minCapacity).toBeNull();
    expect(v.status).toBe("published");
    expect(v.category).toBe("game");
    expect(v.ages).toBe("kids");
    expect(v.locationId).toBeNull();
  });

  it("accepts the form's strings, blank meaning null", () => {
    const parsed = parseSessionFields({
      title: " Draft ",
      slug: "",
      startsAt: "",
      endsAt: "",
      maxCapacity: "",
      minCapacity: "3",
      status: "",
      category: "",
      description: "  ",
    });
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        title: "Draft",
        slug: "draft",
        startsAt: null,
        endsAt: null,
        maxCapacity: null,
        minCapacity: 3,
        status: "draft",
        category: null,
        description: null,
      },
    });
  });

  it("takes any start time, early mornings and off-slot minutes included", () => {
    for (const [startsAt, endsAt] of [
      ["2026-11-07T09:00", "2026-11-07T13:15"],
      ["2026-11-05T07:10", "2026-11-05T08:20"],
      ["2026-11-09T12:00", "2026-11-09T23:59"],
    ]) {
      expect(parseSessionFields({ title: "Shift", startsAt, endsAt }).ok).toBe(
        true,
      );
    }
    expect(
      blamed(
        parseSessionFields({
          title: "Shift",
          startsAt: "2026-11-07T23:30",
          endsAt: "2026-11-08T00:30",
        }),
      ),
    ).toBe("endsAt");
  });

  it("round-trips a session ending at midnight through the form's values", () => {
    const start = wallAt("2026-11-07", 23 * 60);
    const end = wallAt("2026-11-07", 24 * 60);
    expect(end).toBe("2026-11-08T00:00");
    const parsed = parseSessionFields({
      title: "Late",
      startsAt: start,
      endsAt: end,
    });
    if (!parsed.ok) throw new Error(parsed.error);
    const { startsAt, endsAt } = parsed.value;
    expect(endMinutes(startsAt!.toISOString(), endsAt!.toISOString())).toBe(
      24 * 60,
    );
  });

  it("names the field at fault", () => {
    expect(parseSessionFields({})).toEqual({
      ok: false,
      field: "title",
      error: "Required.",
    });
    const x = { title: "x" };
    expect(blamed(parseSessionFields({ ...x, startsAt: "soon" }))).toBe(
      "startsAt",
    );
    expect(
      blamed(parseSessionFields({ ...x, startsAt: "2026-11-06T18:30" })),
    ).toBe("endsAt");
    expect(
      parseSessionFields({
        ...x,
        startsAt: "2026-11-06T18:30",
        endsAt: "2026-11-06T18:30",
      }),
    ).toMatchObject({ ok: false, error: "End must be after start." });
    expect(blamed(parseSessionFields({ ...x, maxCapacity: 1.5 }))).toBe(
      "maxCapacity",
    );
    expect(blamed(parseSessionFields({ ...x, minCapacity: "ten" }))).toBe(
      "minCapacity",
    );
    expect(parseSessionFields({ ...x, status: "published" })).toEqual({
      ok: false,
      field: "status",
      error: "A published session needs a start and end time.",
    });
    expect(blamed(parseSessionFields({ ...x, status: "live" }))).toBe("status");
    expect(blamed(parseSessionFields({ ...x, category: "panel" }))).toBe(
      "category",
    );
    expect(blamed(parseSessionFields({ ...x, ages: "teens" }))).toBe("ages");
  });
});

describe("parseLocationFields", () => {
  it("reads each visibility level, defaulting to hidden", () => {
    expect(
      parseLocationFields({ name: "Hall", visibility: "public" }),
    ).toMatchObject({ value: { visibility: "public", displayOrder: 100 } });
    expect(
      parseLocationFields({ name: "Hall", visibility: "volunteer" }),
    ).toMatchObject({ value: { visibility: "volunteer" } });
    expect(parseLocationFields({ name: "Hall" })).toMatchObject({
      value: { visibility: "hidden" },
    });
  });

  it("rejects a missing name, non-integers and an unknown level", () => {
    expect(blamed(parseLocationFields({}))).toBe("name");
    expect(blamed(parseLocationFields({ name: "Hall", capacity: "big" }))).toBe(
      "capacity",
    );
    expect(
      blamed(parseLocationFields({ name: "Hall", displayOrder: "first" })),
    ).toBe("displayOrder");
    expect(
      blamed(parseLocationFields({ name: "Hall", visibility: "on" })),
    ).toBe("visibility");
  });
});

describe("airtableRfpRecordId", () => {
  const base = { title: "Chess" };
  it("is left as stored when not mentioned", () => {
    const r = parseSessionFields(base);
    expect(r.ok && r.value.airtableRfpRecordId).toBeUndefined();
  });
  it("takes a record id, or null to clear", () => {
    const r = parseSessionFields({
      ...base,
      airtableRfpRecordId: "rec0M8Nq1mc3qApko",
    });
    expect(r.ok && r.value.airtableRfpRecordId).toBe("rec0M8Nq1mc3qApko");
    const cleared = parseSessionFields({ ...base, airtableRfpRecordId: null });
    expect(cleared.ok && cleared.value.airtableRfpRecordId).toBeNull();
  });
  it("rejects anything else", () => {
    const r = parseSessionFields({ ...base, airtableRfpRecordId: "row 12" });
    expect(!r.ok && r.field).toBe("airtableRfpRecordId");
  });
});

describe("session flags", () => {
  const base = { title: "Chess" };
  it("are off unless given, as an unticked checkbox sends nothing", () => {
    expect(parseSessionFields(base)).toMatchObject({
      ok: true,
      value: { rsvpIsCommitment: false, sponsored: false },
    });
  });
  it("take a ticked checkbox or a JSON boolean", () => {
    expect(
      parseSessionFields({ ...base, rsvpIsCommitment: "on", sponsored: true }),
    ).toMatchObject({
      ok: true,
      value: { rsvpIsCommitment: true, sponsored: true },
    });
    expect(
      parseSessionFields({ ...base, rsvpIsCommitment: false, sponsored: "" }),
    ).toMatchObject({
      ok: true,
      value: { rsvpIsCommitment: false, sponsored: false },
    });
  });
  it("reject anything else", () => {
    expect(blamed(parseSessionFields({ ...base, sponsored: "yes" }))).toBe(
      "sponsored",
    );
    expect(blamed(parseSessionFields({ ...base, rsvpIsCommitment: 1 }))).toBe(
      "rsvpIsCommitment",
    );
  });
});

describe("shepherdUserId", () => {
  const base = { title: "Chess" };
  it("is left as stored when not mentioned", () => {
    const r = parseSessionFields(base);
    expect(r.ok && r.value.shepherdUserId).toBeUndefined();
  });
  it("takes a user id, with blank or null clearing it", () => {
    const r = parseSessionFields({ ...base, shepherdUserId: " u_123 " });
    expect(r.ok && r.value.shepherdUserId).toBe("u_123");
    for (const shepherdUserId of [null, ""]) {
      const cleared = parseSessionFields({ ...base, shepherdUserId });
      expect(cleared.ok && cleared.value.shepherdUserId).toBeNull();
    }
  });
  it("rejects a non-string", () => {
    const r = parseSessionFields({ ...base, shepherdUserId: { id: 1 } });
    expect(!r.ok && r.field).toBe("shepherd");
  });
});

describe("parseHostSessionFields", () => {
  it("keeps the descriptive fields", () => {
    const r = parseHostSessionFields({
      title: " Dice Night ",
      description: "Bring dice",
      category: "game",
      ages: "all",
      needs: "A big table",
      maxCapacity: "20",
      minCapacity: "4",
      rsvpIsCommitment: "on",
    });
    expect(r.ok && r.value).toEqual({
      title: "Dice Night",
      description: "Bring dice",
      category: "game",
      ages: "all",
      needs: "A big table",
      maxCapacity: 20,
      minCapacity: 4,
      rsvpIsCommitment: true,
    });
  });

  it("reads an unchecked commitment box as false", () => {
    const r = parseHostSessionFields({ title: "Dice Night" });
    expect(r.ok && r.value.rsvpIsCommitment).toBe(false);
  });

  it("drops placement, status and slug even when they are sent", () => {
    const r = parseHostSessionFields({
      title: "Dice Night",
      slug: "somewhere-else",
      status: "published",
      startsAt: "2026-11-06T14:00",
      endsAt: "2026-11-06T15:00",
      locationId: "00000000-0000-0000-0000-000000000000",
      shepherdUserId: "u_1",
      sponsored: "on",
    });
    expect(r.ok && Object.keys(r.value).sort()).toEqual([
      "ages",
      "category",
      "description",
      "maxCapacity",
      "minCapacity",
      "needs",
      "rsvpIsCommitment",
      "title",
    ]);
  });

  it("needs a title", () => {
    expect(blamed(parseHostSessionFields({ title: "  " }))).toBe("title");
  });

  it("rejects capacities that do not make sense", () => {
    expect(
      blamed(parseHostSessionFields({ title: "A", maxCapacity: "0" })),
    ).toBe("maxCapacity");
    expect(
      blamed(
        parseHostSessionFields({
          title: "A",
          minCapacity: "10",
          maxCapacity: "4",
        }),
      ),
    ).toBe("minCapacity");
  });

  it("rejects an unknown category or age range", () => {
    expect(
      blamed(parseHostSessionFields({ title: "A", category: "banquet" })),
    ).toBe("category");
    expect(blamed(parseHostSessionFields({ title: "A", ages: "teens" }))).toBe(
      "ages",
    );
  });
});
