import { env } from "@/env";
import { airtableConfig, airtableFetch } from "@/lib/airtable-config";
import { fetchWithin } from "@/lib/fetch-timeout";

// Rows from the site's journeys (src/v2/forms), written where the Airtable
// forms they replaced used to write. Fields are addressed by id. typecast
// keeps a submission from bouncing if an option is relabeled in Airtable,
// though it then recreates the old option: update the journey to match.

export type FormRowResult = { stored: boolean; id?: string };

// Up to 5 MB of base64, so it gets longer than a row write.
const uploadFetch = fetchWithin(30_000);

const headers = (key: string) => ({
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
});

/**
 * Create a row in `tableId` and return its id. No-ops (with a warning) when
 * Airtable isn't configured, like recordSignup, so local dev still works.
 */
export async function createFormRow(
  tableId: string,
  fields: Record<string, unknown>,
): Promise<FormRowResult> {
  const { AIRTABLE_API_KEY } = env;
  if (!AIRTABLE_API_KEY) {
    console.warn(
      `[forms] Airtable not configured — row not stored in ${tableId}:`,
      fields,
    );
    return { stored: false };
  }
  const res = await airtableFetch(
    `https://api.airtable.com/v0/${airtableConfig.baseId}/${tableId}`,
    {
      method: "POST",
      headers: headers(AIRTABLE_API_KEY),
      body: JSON.stringify({ fields, typecast: true }),
    },
  );
  if (!res.ok) {
    throw new Error(`Airtable responded ${res.status}: ${await res.text()}`);
  }
  const { id } = (await res.json()) as { id: string };
  return { stored: true, id };
}

/**
 * Attach a file to a row's attachment field, sent as base64 (Airtable takes
 * up to 5 MB this way, so there's no need to host the file first).
 */
export async function attachFile(
  recordId: string,
  fieldId: string,
  file: { name: string; type: string; data: string },
): Promise<void> {
  const { AIRTABLE_API_KEY } = env;
  if (!AIRTABLE_API_KEY) return;
  const res = await uploadFetch(
    `https://content.airtable.com/v0/${airtableConfig.baseId}/${recordId}/${fieldId}/uploadAttachment`,
    {
      method: "POST",
      headers: headers(AIRTABLE_API_KEY),
      body: JSON.stringify({
        contentType: file.type,
        file: file.data,
        filename: file.name,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `Airtable upload responded ${res.status}: ${await res.text()}`,
    );
  }
}
