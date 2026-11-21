import type { CellValue } from "./google-sheets";

// The "2026 Transactions v2" tab of the Metagame 2026 Budget sheet: one row
// per planned or actual item, a Parent column making a two-level plan
// hierarchy, and formula columns (E F L M N T) that are never written.
// Pure helpers only; the sheet IO is in budget-sheet.ts.

export const STATUSES = [
  "Proposed",
  "Planned",
  "Committed",
  "Partial",
  "Done",
  "Closed",
] as const;
export type Status = (typeof STATUSES)[number];

export const PHASES = ["Pre", "Event", "Post"] as const;
export type Phase = (typeof PHASES)[number];

export type LedgerRow = {
  /** 1-based sheet row. */
  row: number;
  id: string;
  item: string;
  parent: string;
  category: string;
  group: string;
  type: string;
  phase: string;
  counterparty: string;
  budgeted: number | null;
  actual: number | null;
  /** Owed but not yet paid; the sheet's formulas count it as spend. */
  committed: number | null;
  forecast: number | null;
  remaining: number | null;
  status: string;
  /** ISO date, from the sheet's serial. */
  date: string | null;
  notes: string;
  xeroId: string;
  xeroDescription: string;
  flags: string;
  proposal: string;
};

export type Category = {
  type: string;
  group: string;
  name: string;
  budget: number | null;
  /** The Categories tab's own rollups (cols E–J), as the sheet computes them. */
  allocated: number | null;
  unallocated: number | null;
  actual: number | null;
  unplanned: number | null;
  unallocatedRemaining: number | null;
  forecast: number | null;
};

/** The fields a new or edited row carries; formula columns are never written. */
export type RowInput = {
  id: string;
  item: string;
  parent?: string;
  category: string;
  phase?: string;
  counterparty?: string;
  budgeted?: number | null;
  actual?: number | null;
  committed?: number | null;
  status: Status;
  date?: string | null;
  notes?: string;
  xeroId?: string;
  xeroDescription?: string;
  proposal?: string;
};

const str = (v: CellValue | undefined): string =>
  v === null || v === undefined ? "" : String(v);

const num = (v: CellValue | undefined): number | null =>
  typeof v === "number" ? v : null;

const EPOCH = Date.UTC(1899, 11, 30);

/** Sheets serial day → ISO date. */
export function serialToIso(serial: number): string {
  return new Date(EPOCH + Math.round(serial) * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** ISO date → Sheets serial day, the sheet's own date representation. */
export function isoToSerial(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / 86_400_000);
}

export function parseLedger(values: CellValue[][]): LedgerRow[] {
  const rows: LedgerRow[] = [];
  values.forEach((v, i) => {
    const id = str(v[0]).trim();
    const item = str(v[1]).trim();
    if (!id && !item) return;
    const serial = num(v[15]);
    rows.push({
      row: i + 2,
      id,
      item,
      parent: str(v[2]).trim(),
      category: str(v[3]).trim(),
      group: str(v[4]),
      type: str(v[5]),
      phase: str(v[6]).trim(),
      counterparty: str(v[7]),
      budgeted: num(v[8]),
      actual: num(v[9]),
      committed: num(v[10]),
      forecast: num(v[12]),
      remaining: num(v[13]),
      status: str(v[14]).trim(),
      date: serial === null ? null : serialToIso(serial),
      notes: str(v[16]),
      xeroId: str(v[17]).trim(),
      xeroDescription: str(v[18]),
      flags: str(v[19]),
      proposal: str(v[20]),
    });
  });
  return rows;
}

export function parseCategories(values: CellValue[][]): Category[] {
  return values
    .map((v) => ({
      type: str(v[0]).trim(),
      group: str(v[1]).trim(),
      name: str(v[2]).trim(),
      budget: num(v[3]),
      allocated: num(v[4]),
      unallocated: num(v[5]),
      actual: num(v[6]),
      unplanned: num(v[7]),
      unallocatedRemaining: num(v[8]),
      forecast: num(v[9]),
    }))
    .filter((c) => c.name && (c.type === "Income" || c.type === "Expense"));
}

/** T### after the highest existing one. */
export function nextId(rows: { id: string }[]): string {
  let max = 0;
  for (const { id } of rows) {
    const m = /^T(\d+)$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `T${String(max + 1).padStart(3, "0")}`;
}

/** Rows that may be a Parent: open plan rows that are themselves roots. */
export const isPlanRow = (r: LedgerRow): boolean =>
  !r.parent &&
  r.status !== "Closed" &&
  r.status !== "Proposed" &&
  (r.budgeted !== null || r.status === "Planned" || r.status === "Committed");

export const toInput = (r: LedgerRow): RowInput => ({
  id: r.id,
  item: r.item,
  parent: r.parent,
  category: r.category,
  phase: r.phase,
  counterparty: r.counterparty,
  budgeted: r.budgeted,
  actual: r.actual,
  committed: r.committed,
  status: (STATUSES as readonly string[]).includes(r.status)
    ? (r.status as Status)
    : "Planned",
  date: r.date,
  notes: r.notes,
  xeroId: r.xeroId,
  xeroDescription: r.xeroDescription,
  proposal: r.proposal,
});
