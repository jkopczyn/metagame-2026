import { describe, expect, it } from "vitest";
import {
  buildRequestRows,
  buildRows,
  defaultSince,
  ledgerAmount,
  xeroDateToIso,
  type XeroLine,
} from "./budget-import";
import type { Category, LedgerRow } from "./budget-ledger";

const line = (over: Partial<XeroLine>): XeroLine => ({
  xeroId: "abcd1234",
  date: "2026-10-20",
  kind: "SPEND",
  contact: "Uber",
  amount: 25,
  accountCode: "6300",
  account: "Rideshare / Taxi",
  description: "metagame uber",
  ...over,
});

const row = (over: Partial<LedgerRow>): LedgerRow => ({
  row: 2,
  id: "T001",
  item: "",
  parent: "",
  category: "",
  group: "",
  type: "",
  phase: "",
  counterparty: "",
  budgeted: null,
  actual: null,
  committed: null,
  forecast: null,
  remaining: null,
  status: "Planned",
  date: null,
  notes: "",
  xeroId: "",
  xeroDescription: "",
  flags: "",
  proposal: "",
  ...over,
});

const cat = (group: string, name: string, budget: number): Category => ({
  type: "Expense",
  group,
  name,
  budget,
  allocated: null,
  unallocated: null,
  actual: null,
  unplanned: null,
  unallocatedRemaining: null,
  forecast: null,
});

const categories: Category[] = [
  cat("Core team", "Staff cars", 1800),
  cat("Core team", "Staff travel", 3250),
  cat("Contingency", "Contingency (oops)", 5000),
];

describe("budget import", () => {
  it("parses Xero's wrapped dates", () => {
    expect(xeroDateToIso("/Date(1792281600000+0000)/")).toBe("2026-10-18");
  });

  it("makes expense refunds negative and leaves income positive", () => {
    expect(ledgerAmount(line({}))).toBe(25);
    expect(ledgerAmount(line({ kind: "RECEIVE" }))).toBe(-25);
    expect(ledgerAmount(line({ kind: "RECEIVE", accountCode: "4200" }))).toBe(
      25,
    );
  });

  it("starts two weeks before the newest imported line", () => {
    expect(defaultSince([])).toBe("2026-01-01");
    expect(
      defaultSince([
        row({ xeroId: "a", date: "2026-10-23" }),
        row({ date: "2026-12-01" }),
      ]),
    ).toBe("2026-10-09");
  });

  it("repairs bad categories and parents, keeping the model's reason", () => {
    const rows = [
      row({
        id: "T017",
        item: "Sparr travel",
        category: "Staff travel",
        budgeted: 350,
        status: "Planned",
      }),
      row({
        id: "T021",
        item: "Sparr flights",
        parent: "T017",
        category: "Staff travel",
        actual: 377,
        status: "Done",
      }),
    ];
    const lines = [
      line({}),
      line({
        xeroId: "ffff0000",
        accountCode: "6200",
        account: "Flights",
        description: "Sparr return flight",
      }),
    ];
    const out = buildRows(
      {
        summary: "",
        newParents: [],
        proposals: [
          {
            xeroId: "abcd1234",
            item: "Uber",
            category: "Staff Cars",
            parent: "T021",
            phase: "Pre",
            counterparty: "Uber",
            confidence: "high",
            reason: "rideshare",
          },
          {
            xeroId: "ffff0000",
            item: "Sparr return flight",
            category: "Staff travel",
            parent: "T017",
            phase: "Event",
            counterparty: "Sparr",
            confidence: "high",
            reason: "flight",
          },
        ],
      },
      lines,
      rows,
      categories,
      "2026-10-25",
    );
    expect(out[0]).toMatchObject({
      id: "T022",
      category: "Contingency (oops)",
      parent: "",
      actual: 25,
      status: "Proposed",
      xeroId: "abcd1234",
    });
    expect(out[0].proposal).toMatch(/unknown/);
    expect(out[0].proposal).toMatch(/not found/);
    expect(out[1]).toMatchObject({
      id: "T023",
      parent: "T017",
      category: "Staff travel",
      date: "2026-10-20",
    });
  });

  it("creates proposed parents first and links children to them", () => {
    const out = buildRows(
      {
        summary: "",
        newParents: [
          {
            tempId: "p1",
            item: "Van rental",
            category: "Staff cars",
            phase: "Event",
            budgeted: 900,
            reason: "deposit",
          },
        ],
        proposals: [
          {
            xeroId: "abcd1234",
            item: "Van deposit",
            category: "Staff cars",
            parent: "p1",
            phase: "Event",
            counterparty: "Hertz",
            confidence: "medium",
            reason: "first half",
          },
        ],
      },
      [line({})],
      [],
      categories,
      "2026-10-25",
    );
    expect(out.map((r) => r.id)).toEqual(["T001", "T002"]);
    expect(out[0]).toMatchObject({ budgeted: 900, status: "Proposed" });
    // A plan row has no spend of its own; toMatchObject can't say "absent".
    expect(out[0].actual).toBeUndefined();
    expect(out[1].parent).toBe("T001");
  });

  it("builds a requested plan with its children in one answer", () => {
    const inputs = buildRequestRows(
      {
        rows: [
          {
            key: null,
            item: "Uber to JFK",
            category: "Staff cars",
            parent: "p1",
            phase: "Event",
            counterparty: "Uber",
            budgeted: 65,
            actual: null,
            status: "Planned",
            reason: "outbound",
          },
          {
            key: "p1",
            item: "Yemima cars",
            category: "Staff cars",
            parent: null,
            phase: "Event",
            counterparty: "",
            budgeted: 150,
            actual: null,
            status: "Planned",
            reason: "envelope",
          },
          {
            key: null,
            item: "Uber from JFK",
            category: "Staff travel",
            parent: "p1",
            phase: "Event",
            counterparty: "Uber",
            budgeted: 65,
            actual: null,
            status: "Planned",
            reason: "return",
          },
        ],
        summary: "three rows",
      },
      [],
      categories,
      "Brian",
      "ubers to and from JFK",
      "2026-10-26",
    );
    expect(inputs.map((i) => [i.id, i.item, i.parent])).toEqual([
      ["T001", "Yemima cars", ""],
      ["T002", "Uber to JFK", "T001"],
      ["T003", "Uber from JFK", ""],
    ]);
    expect(inputs[2].proposal).toContain("is in Staff cars, left blank");
    expect(inputs.every((i) => i.status === "Proposed")).toBe(true);
  });
});
