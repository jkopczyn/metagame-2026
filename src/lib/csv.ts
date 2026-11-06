export type CsvCell =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | readonly string[];

// A leading = + - @ makes spreadsheets evaluate a text cell as a formula.
const FORMULA = /^[=+\-@\t\r]/;

function cell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  let text: string;
  if (value instanceof Date) text = value.toISOString();
  else if (Array.isArray(value)) text = value.join(" ");
  else if (typeof value === "string")
    text = FORMULA.test(value) ? `'${value}` : value;
  else text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(
  columns: readonly string[],
  rows: readonly (readonly CsvCell[])[],
): string {
  return [columns, ...rows].map((r) => r.map(cell).join(",") + "\r\n").join("");
}
