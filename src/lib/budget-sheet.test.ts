import { describe, expect, it } from "vitest";
import {
  isoToSerial,
  nextId,
  parseCategories,
  parseLedger,
  serialToIso,
} from "./budget-ledger";

describe("budget sheet", () => {
  it("round-trips dates through the sheet's serial days", () => {
    expect(isoToSerial("1899-12-31")).toBe(1);
    expect(serialToIso(isoToSerial("2026-10-25"))).toBe("2026-10-25");
    expect(serialToIso(46320)).toBe("2026-10-25");
  });

  it("numbers the next row after the highest id", () => {
    expect(nextId([])).toBe("T001");
    expect(nextId([{ id: "T003" }, { id: "T110" }, { id: "x" }])).toBe("T111");
  });

  it("reads ledger rows by position and skips blanks", () => {
    const rows = parseLedger([
      [
        "T001",
        "Venue",
        "",
        "Venue rental",
        "Venue",
        "Expense",
        "Event",
        "Lighthaven",
        52000,
        26000,
        1500,
        52000,
        52000,
        0,
        "Partial",
        46300,
        "",
        "c526669e",
        "",
        "",
        "",
      ],
      [],
      ["", "", "", ""],
      ["T002", "", "T001", "Venue rental"],
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      row: 2,
      id: "T001",
      actual: 26000,
      committed: 1500,
      status: "Partial",
      xeroId: "c526669e",
    });
    expect(rows[0].date).toBe(serialToIso(46300));
    expect(rows[1]).toMatchObject({
      row: 5,
      parent: "T001",
      budgeted: null,
      date: null,
    });
  });

  it("keeps only income and expense category rows", () => {
    const cats = parseCategories([
      ["Income", "Revenue", "Tickets", 53000],
      ["Total income", "", "", 101500],
      [],
      ["Expense", "Venue", "Venue rental", 52000, 52000, 0, 26000, 0, 0, 52000],
      ["Expense", "Overhead", "Taxes", ""],
    ]);
    expect(cats.map((c) => c.name)).toEqual([
      "Tickets",
      "Venue rental",
      "Taxes",
    ]);
    expect(cats[2].budget).toBeNull();
    expect(cats[1].actual).toBe(26000);
    expect(cats[1].forecast).toBe(52000);
    expect(cats[2].forecast).toBeNull();
  });
});
