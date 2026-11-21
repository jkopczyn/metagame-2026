import { env } from "@/env";
import {
  deleteRow,
  insertRow,
  readRanges,
  sheetIdByTitle,
  writeRanges,
  type CellValue,
} from "./google-sheets";
import {
  isoToSerial,
  parseCategories,
  parseLedger,
  type Category,
  type LedgerRow,
  type RowInput,
} from "./budget-ledger";

// Reads and writes against the Metagame 2026 Budget sheet. Categories are
// income from row 5 and expenses from row 10; the read runs long so inserted
// rows are seen and the Type filter drops the rows between. The row model,
// column rules and pure helpers live in budget-ledger.ts so client code can
// import them without pulling in the service-account client.

export const DEFAULT_SHEET_ID = "1VRbMkCw9efO6ULxKuo9SxXA9zDcrMdsB4UjV_cu-1ak";
export const LEDGER_TAB = "2026 Transactions v2";
export const CATEGORIES_TAB = "2026 Categories";
const LAST_ROW = 400;

export const sheetId = (): string => env.BUDGET_SHEET_ID ?? DEFAULT_SHEET_ID;

export const sheetUrl = (): string =>
  `https://docs.google.com/spreadsheets/d/${sheetId()}/edit`;

export * from "./budget-ledger";

export async function loadLedger(): Promise<{
  rows: LedgerRow[];
  categories: Category[];
}> {
  const [ledger, categories] = await readRanges(sheetId(), [
    `'${LEDGER_TAB}'!A2:U${LAST_ROW}`,
    `'${CATEGORIES_TAB}'!A5:J80`,
  ]);
  return { rows: parseLedger(ledger), categories: parseCategories(categories) };
}

const cell = (v: string | number | null | undefined): CellValue =>
  v === undefined || v === null ? "" : v;

/** The three writable spans of a row (plus Proposal), as batch ranges. */
function rowRanges(
  row: number,
  r: RowInput,
): { range: string; values: CellValue[][] }[] {
  const tab = `'${LEDGER_TAB}'`;
  return [
    {
      range: `${tab}!A${row}:D${row}`,
      values: [[r.id, r.item, cell(r.parent), r.category]],
    },
    {
      range: `${tab}!G${row}:K${row}`,
      values: [
        [
          cell(r.phase),
          cell(r.counterparty),
          cell(r.budgeted),
          cell(r.actual),
          cell(r.committed),
        ],
      ],
    },
    {
      range: `${tab}!O${row}:S${row}`,
      values: [
        [
          r.status,
          r.date ? isoToSerial(r.date) : "",
          cell(r.notes),
          cell(r.xeroId),
          cell(r.xeroDescription),
        ],
      ],
    },
    { range: `${tab}!U${row}`, values: [[cell(r.proposal)]] },
  ];
}

/** Appends after the last used row. Caller assigns ids with nextId(). */
export async function appendRows(
  existing: LedgerRow[],
  rows: RowInput[],
): Promise<void> {
  const last = existing.reduce((m, r) => Math.max(m, r.row), 1);
  if (last + rows.length > LAST_ROW) {
    throw new Error(`The ledger tab is full (row ${LAST_ROW}). Add rows.`);
  }
  await writeRanges(
    sheetId(),
    rows.flatMap((r, i) => rowRanges(last + 1 + i, r)),
  );
}

/** Rewrites one row's writable cells in place. */
export async function replaceRow(row: number, r: RowInput): Promise<void> {
  await writeRanges(sheetId(), rowRanges(row, r));
}

export async function removeRow(row: number): Promise<void> {
  const tab = await sheetIdByTitle(sheetId(), LEDGER_TAB);
  await deleteRow(sheetId(), tab, row);
}

export type CategoryKey = { type: string; group: string; name: string };

type CategoryRow = CategoryKey & { row: number; budget: number | null };

/** The Categories tab's input columns with their sheet rows, read fresh. */
async function readCategoryRows(): Promise<CategoryRow[]> {
  const [values] = await readRanges(sheetId(), [`'${CATEGORIES_TAB}'!A5:D80`]);
  return values.flatMap((v, i) =>
    parseCategories([v]).map((c) => ({ ...c, row: 5 + i })),
  );
}

const same = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/** Adds a category inside its type's block so the rollups and dropdown see it. */
export async function addCategory(
  input: CategoryKey & { budget: number | null },
): Promise<void> {
  const [rows, tab] = await Promise.all([
    readCategoryRows(),
    sheetIdByTitle(sheetId(), CATEGORIES_TAB),
  ]);
  if (rows.some((c) => same(c.name, input.name))) {
    throw new Error(`There's already a category named ${input.name}.`);
  }
  const ofType = rows.filter((c) => c.type === input.type);
  const last = ofType.at(-1);
  if (!last) throw new Error(`No ${input.type} rows found to insert after.`);
  const inGroup = ofType.filter((c) => same(c.group, input.group));
  const anchor = inGroup.at(-1);
  // Ranges only stretch for inserts strictly inside them, so a new last row
  // goes in above the block's current last row rather than below it, and a
  // new group goes in above the whole last group (unless that is the only
  // group, which would put it outside the block).
  const lastGroupStart = ofType.find((c) => c.group === last.group)!;
  const row = !anchor
    ? lastGroupStart === ofType[0]
      ? last.row
      : lastGroupStart.row
    : anchor === last
      ? anchor.row
      : anchor.row + 1;
  await insertRow(sheetId(), tab, row, [
    input.type,
    anchor ? anchor.group : input.group.trim(),
    input.name,
    cell(input.budget),
  ]);
}

export async function setCategoryBudget(
  key: CategoryKey,
  budget: number | null,
): Promise<void> {
  const match = (await readCategoryRows()).find(
    (c) => c.type === key.type && c.group === key.group && c.name === key.name,
  );
  if (!match) throw new Error(`${key.name} is no longer in the sheet.`);
  await writeRanges(sheetId(), [
    { range: `'${CATEGORIES_TAB}'!D${match.row}`, values: [[cell(budget)]] },
  ]);
}
