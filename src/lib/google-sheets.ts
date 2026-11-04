import "server-only";
import { createSign } from "node:crypto";
import { env } from "@/env";

// Google Sheets over a service account, with no client library: the key JSON
// signs a JWT, Google swaps it for a bearer token, and the values API is plain
// REST. Share the sheet with the account's client_email as an editor.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const API = "https://sheets.googleapis.com/v4/spreadsheets";

type ServiceAccount = { client_email: string; private_key: string };

export type CellValue = string | number | boolean | null;

export const sheetsConfigured = (): boolean =>
  Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON);

function serviceAccount(): ServiceAccount {
  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set.");
  const text = raw.trim().startsWith("{")
    ? raw
    : Buffer.from(raw, "base64").toString("utf8");
  const parsed = JSON.parse(text) as Partial<ServiceAccount>;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON needs client_email and private_key.",
    );
  }
  return parsed as ServiceAccount;
}

const b64url = (input: string | Buffer) =>
  Buffer.from(input).toString("base64url");

let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }
  const account = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: account.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = b64url(signer.sign(account.private_key));
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token request failed: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.value;
}

async function call<T>(
  spreadsheetId: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await accessToken();
  const res = await fetch(`${API}/${spreadsheetId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!res.ok) {
    throw new Error(
      `Sheets ${init.method ?? "GET"} ${path}: ${await res.text()}`,
    );
  }
  return (await res.json()) as T;
}

const encodeRange = (range: string) => encodeURIComponent(range);

export async function readRanges(
  spreadsheetId: string,
  ranges: string[],
): Promise<CellValue[][][]> {
  const query = ranges.map((r) => `ranges=${encodeRange(r)}`).join("&");
  const data = await call<{ valueRanges?: { values?: CellValue[][] }[] }>(
    spreadsheetId,
    `/values:batchGet?${query}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`,
  );
  return (data.valueRanges ?? []).map((v) => v.values ?? []);
}

/** Writes several ranges as the user would type them (formulas, numbers). */
export async function writeRanges(
  spreadsheetId: string,
  data: { range: string; values: CellValue[][] }[],
): Promise<void> {
  if (data.length === 0) return;
  await call(spreadsheetId, "/values:batchUpdate", {
    method: "POST",
    body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }),
  });
}

export async function sheetIdByTitle(
  spreadsheetId: string,
  title: string,
): Promise<number> {
  const data = await call<{
    sheets: { properties: { sheetId: number; title: string } }[];
  }>(spreadsheetId, "?fields=sheets.properties(sheetId,title)");
  const sheet = data.sheets.find((s) => s.properties.title === title);
  if (!sheet) throw new Error(`No tab named ${title}.`);
  return sheet.properties.sheetId;
}

/** Removes one row (1-based) from a tab, shifting the rest up. */
export async function deleteRow(
  spreadsheetId: string,
  sheetId: number,
  row: number,
): Promise<void> {
  await call(spreadsheetId, ":batchUpdate", {
    method: "POST",
    body: JSON.stringify({
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: row - 1,
              endIndex: row,
            },
          },
        },
      ],
    }),
  });
}

const cellData = (v: CellValue) =>
  v === null || v === ""
    ? {}
    : typeof v === "number"
      ? { userEnteredValue: { numberValue: v } }
      : typeof v === "boolean"
        ? { userEnteredValue: { boolValue: v } }
        : { userEnteredValue: { stringValue: v } };

/**
 * Inserts a row at a 1-based row (what was there shifts down), inheriting the
 * format of the row above, and fills it from column A in the same request so
 * a failed write can't leave a blank row behind.
 */
export async function insertRow(
  spreadsheetId: string,
  sheetId: number,
  row: number,
  values: CellValue[],
): Promise<void> {
  await call(spreadsheetId, ":batchUpdate", {
    method: "POST",
    body: JSON.stringify({
      requests: [
        {
          insertDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: row - 1,
              endIndex: row,
            },
            inheritFromBefore: true,
          },
        },
        {
          updateCells: {
            start: { sheetId, rowIndex: row - 1, columnIndex: 0 },
            rows: [{ values: values.map(cellData) }],
            fields: "userEnteredValue",
          },
        },
      ],
    }),
  });
}
