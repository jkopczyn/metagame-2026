import "server-only";

import { env } from "@/env";
import { airtableConfig, airtableFetch } from "@/lib/airtable-config";
import { CHILD_FIELDS, FAMILY_FIELDS } from "@/v2/forms/children";

export type Family = {
  recordId: string;
  createdTime: string;
  parentName: string;
  relationship: string;
  email: string;
  phone: string;
  discord: string;
  /** How many children the form said were coming. */
  count: number | null;
  /** Free text about the fifth child onward; can't be split into rows. */
  moreChildren: string;
  anythingElse: string;
};

export type ChildEntry = {
  /** Record id plus the child's slot, unique across the table. */
  key: string;
  name: string;
  age: number | null;
  sessions: string[];
  medical: string;
  notes: string;
  family: Family;
};

export type ChildrenData = {
  children: ChildEntry[];
  /** Families whose "more children" text or declared count has no rows. */
  unlisted: Family[];
};

type AirtableRecord = {
  id: string;
  createdTime: string;
  fields: Record<string, unknown>;
};

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown) => (typeof v === "number" ? v : null);
const list = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

function toFamily(r: AirtableRecord): Family {
  const f = r.fields;
  return {
    recordId: r.id,
    createdTime: r.createdTime,
    parentName: text(f[FAMILY_FIELDS.name]),
    relationship: text(f[FAMILY_FIELDS.relationship]),
    email: text(f[FAMILY_FIELDS.email]),
    phone: text(f[FAMILY_FIELDS.phone]),
    discord: text(f[FAMILY_FIELDS.discord]),
    count: num(f[FAMILY_FIELDS.count]),
    moreChildren: text(f[FAMILY_FIELDS.moreChildren]),
    anythingElse: text(f[FAMILY_FIELDS.anythingElse]),
  };
}

function toChildren(r: AirtableRecord, family: Family): ChildEntry[] {
  const f = r.fields;
  const out: ChildEntry[] = [];
  CHILD_FIELDS.forEach(([name, age, times, medical, other], i) => {
    const child = {
      name: text(f[name]),
      age: num(f[age]),
      sessions: list(f[times]),
      medical: text(f[medical]),
      notes: text(f[other]),
    };
    const empty =
      !child.name &&
      child.age === null &&
      child.sessions.length === 0 &&
      !child.medical &&
      !child.notes;
    if (empty) return;
    out.push({
      ...child,
      key: `${r.id}:${i}`,
      name: child.name || "(unnamed)",
      family,
    });
  });
  return out;
}

/** Every registered child, newest registrations first. */
export async function loadChildren(): Promise<ChildrenData> {
  const { AIRTABLE_API_KEY } = env;
  if (!AIRTABLE_API_KEY) throw new Error("AIRTABLE_API_KEY isn't set.");
  const base = `https://api.airtable.com/v0/${airtableConfig.baseId}/${encodeURIComponent(airtableConfig.childrenTableId)}`;

  const records: AirtableRecord[] = [];
  let offset: string | undefined;
  do {
    const params = new URLSearchParams({
      pageSize: "100",
      returnFieldsByFieldId: "true",
    });
    if (offset) params.set("offset", offset);
    const res = await airtableFetch(`${base}?${params}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
    });
    if (!res.ok) {
      throw new Error(`Airtable responded ${res.status}: ${await res.text()}`);
    }
    const page = (await res.json()) as {
      records: AirtableRecord[];
      offset?: string;
    };
    records.push(...page.records);
    offset = page.offset;
  } while (offset);

  records.sort((a, b) => b.createdTime.localeCompare(a.createdTime));
  const children: ChildEntry[] = [];
  const unlisted: Family[] = [];
  for (const r of records) {
    const family = toFamily(r);
    const rows = toChildren(r, family);
    children.push(...rows);
    if (family.moreChildren || (family.count ?? 0) > rows.length) {
      unlisted.push(family);
    }
  }
  return { children, unlisted };
}
