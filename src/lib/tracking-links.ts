import { env } from "@/env";
import { airtableConfig } from "@/lib/airtable-config";
import { VOLUNTEER_FORM_PATH } from "@/v2/lib/links";

// Short links: /go/{slug} → Destination with the row's UTMs appended. Rows live
// in the Airtable "Tracking Links" table and are created from /backstage/links.

export type TrackingLink = {
  id: string;
  slug: string;
  destination: string;
  source: string;
  medium: string;
  campaign: string;
  placement: string;
  internalName: string;
  createdBy: string;
  createdAt: string;
  active: boolean;
  template: boolean;
};

export type NewTrackingLink = Omit<
  TrackingLink,
  "id" | "createdAt" | "active" | "template"
>;

export const GO_PREFIX = "/go/";

export { PROMO_PARAM, promoCode } from "@/lib/promo-code";

// The UTM fields mirror single-select columns in Airtable; their choice lists
// are the source of truth. Open fields also take a typed value, which `typecast`
// on create turns into a new choice. Values are stored as typed ("Puzzle World")
// and only slugified when the redirect writes the utm_* params.
export const UTM_SELECT_FIELDS = [
  "source",
  "medium",
  "campaign",
  "placement",
] as const;
export type UtmSelectField = (typeof UTM_SELECT_FIELDS)[number];
export const OPEN_SELECTS: ReadonlySet<UtmSelectField> = new Set([
  "source",
  "medium",
  "placement",
]);
export type LinkOptions = Record<UtmSelectField, string[]>;
export const UTM_VALUE_MAX = 100;

/** The option whose spelling matches case-insensitively, else the value as typed. */
export function snapToOption(
  value: string,
  options: readonly string[],
): string {
  const needle = value.trim().toLowerCase();
  return options.find((o) => o.toLowerCase() === needle) ?? value.trim();
}

/** Preselected when Airtable still lists it; otherwise the first choice wins. */
export const PREFERRED_CAMPAIGN = "metagame-2026";
export function defaultCampaign(options: LinkOptions): string {
  return options.campaign.includes(PREFERRED_CAMPAIGN)
    ? PREFERRED_CAMPAIGN
    : (options.campaign[0] ?? "");
}

/** Destinations offered in the form; anything else goes through "Custom URL". */
export const SITE_PAGES = [
  { path: "/", label: "Homepage" },
  { path: "/#tickets", label: "Tickets" },
  { path: "/#speakers", label: "Speakers" },
  { path: "/#get-involved", label: "Get involved" },
  { path: "/#faq", label: "FAQ" },
  { path: "/sponsor", label: "Sponsor" },
  { path: "/childcare", label: "Childcare" },
  { path: "/team", label: "Team" },
  { path: "/last-year", label: "Last year" },
  { path: VOLUNTEER_FORM_PATH, label: "Volunteer form" },
] as const;

export const sitePageUrl = (origin: string, path: string) =>
  `${origin.replace(/\/$/, "")}${path}`;

/** The SITE_PAGES path a saved destination corresponds to, if any. */
export function matchSitePage(
  destination: string,
  origin: string,
): string | null {
  const page = SITE_PAGES.find(
    (p) => sitePageUrl(origin, p.path) === destination,
  );
  return page?.path ?? null;
}

const SLUG_MIN = 3;
const SLUG_MAX = 48;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const UTM_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
];

/** Lowercased, whitespace → hyphens, runs collapsed. Doesn't drop other characters — see `validateSlug`. */
export function normalizeSlug(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, "-").replace(/-{2,}/g, "-");
}

export function validateSlug(slug: string): string | null {
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX)
    return `Short name must be ${SLUG_MIN}–${SLUG_MAX} characters.`;
  if (!SLUG_RE.test(slug))
    return "Short name can only use lowercase letters, digits, and hyphens (not at the ends).";
  return null;
}

/** Display text → URL-safe token: "Puzzle World" → "puzzle-world". Underscores survive for utm values. */
export function slugify(input: string): string {
  return normalizeSlug(input)
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Short name from a placement, stepping past ones already in use: puzzle-world, puzzle-world-2, … */
export function suggestSlug(seed: string, taken: ReadonlySet<string>): string {
  const base = slugify(seed).replace(/_/g, "-").slice(0, SLUG_MAX);
  if (!base) return "";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, SLUG_MAX - String(n).length - 1)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** Only https on the site's own origin, and never back into /go/. */
export function isAllowedDestination(
  destination: string,
  siteOrigin: string,
): boolean {
  let url: URL;
  let site: URL;
  try {
    url = new URL(destination);
    site = new URL(siteOrigin);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:"))
    return false;
  if (url.host !== site.host) return false;
  if (
    url.pathname === GO_PREFIX.slice(0, -1) ||
    url.pathname.startsWith(GO_PREFIX)
  )
    return false;
  return true;
}

export type LinkFields = Omit<NewTrackingLink, "createdBy">;
export type LinkProblem = { field: string; error: string };

const hostOf = (origin: string) => {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
};

/**
 * Validation shared by the /backstage/links form and the JSON API, so the two
 * can't drift. `raw` is FormData entries or a JSON body; a blank campaign
 * takes the default. The slug still needs its taken-check.
 */
export function parseLinkFields(
  raw: Record<string, unknown>,
  options: LinkOptions,
  origin: string,
): { ok: true; fields: LinkFields } | ({ ok: false } & LinkProblem) {
  const str = (key: string) => {
    const v = raw[key];
    return typeof v === "string" ? v.trim() : "";
  };
  const destination = str("destination");
  if (!isAllowedDestination(destination, origin)) {
    return {
      ok: false,
      field: "destination",
      error: `Destination must be an https link on ${hostOf(origin)}.`,
    };
  }
  const utm = {} as Record<UtmSelectField, string>;
  for (const field of UTM_SELECT_FIELDS) {
    const given = str(field);
    const value =
      field === "campaign" && !given
        ? defaultCampaign(options)
        : snapToOption(given, options[field]);
    if (!value) return { ok: false, field, error: "Required." };
    if (value.length > UTM_VALUE_MAX)
      return {
        ok: false,
        field,
        error: `At most ${UTM_VALUE_MAX} characters.`,
      };
    if (!OPEN_SELECTS.has(field) && !options[field].includes(value))
      return { ok: false, field, error: `Pick a ${field} from the list.` };
    utm[field] = value;
  }
  const slug = normalizeSlug(str("slug"));
  if (!slug) return { ok: false, field: "slug", error: "Required." };
  const slugProblem = validateSlug(slug);
  if (slugProblem) return { ok: false, field: "slug", error: slugProblem };
  return {
    ok: true,
    fields: {
      slug,
      destination,
      ...utm,
      internalName: str("internalName").slice(0, 120),
    },
  };
}

/** Destination with this link's UTMs, replacing any it already carried. Other params and the fragment survive. */
export function buildDestinationUrl(
  link: Pick<
    TrackingLink,
    "destination" | "slug" | "source" | "medium" | "campaign" | "placement"
  >,
): string {
  const url = new URL(link.destination);
  for (const key of UTM_PARAMS) url.searchParams.delete(key);
  url.searchParams.set("utm_source", slugify(link.source));
  url.searchParams.set("utm_medium", slugify(link.medium));
  url.searchParams.set("utm_campaign", link.campaign);
  if (link.placement)
    url.searchParams.set("utm_content", slugify(link.placement));
  url.searchParams.set("utm_term", link.slug);
  return url.toString();
}

export function shortUrl(siteOrigin: string, slug: string): string {
  return `${siteOrigin.replace(/\/$/, "")}${GO_PREFIX}${slug}`;
}

// --- Airtable ---

type AirtableRecord = {
  id: string;
  createdTime: string;
  fields: Record<string, unknown>;
};

const text = (v: unknown) => (typeof v === "string" ? v : "");

function toLink(record: AirtableRecord): TrackingLink {
  const f = record.fields;
  return {
    id: record.id,
    slug: text(f.Slug),
    destination: text(f.Destination),
    source: text(f.Source),
    medium: text(f.Medium),
    campaign: text(f.Campaign),
    placement: text(f.Placement),
    internalName: text(f["Internal Name"]),
    createdBy: text(f["Created By"]),
    createdAt: record.createdTime,
    active: f.Active === true,
    template: f.Template === true,
  };
}

function tableUrl() {
  return `https://api.airtable.com/v0/${airtableConfig.baseId}/${encodeURIComponent(airtableConfig.trackingLinksTableId)}`;
}

async function airtable(url: string, init?: RequestInit) {
  const { AIRTABLE_API_KEY } = env;
  if (!AIRTABLE_API_KEY) throw new Error("Airtable is not configured");
  const res = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`Airtable responded ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

/** Every link, newest first. */
export async function listTrackingLinks(): Promise<TrackingLink[]> {
  const records: AirtableRecord[] = [];
  let offset: string | undefined;
  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (offset) params.set("offset", offset);
    const page = (await airtable(`${tableUrl()}?${params}`)) as {
      records: AirtableRecord[];
      offset?: string;
    };
    records.push(...page.records);
    offset = page.offset;
  } while (offset);
  return records
    .map(toLink)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const escapeFormula = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export async function findTrackingLink(
  slug: string,
  signal?: AbortSignal,
): Promise<TrackingLink | null> {
  const params = new URLSearchParams({
    filterByFormula: `LOWER({Slug})='${escapeFormula(slug)}'`,
    maxRecords: "1",
  });
  const page = (await airtable(`${tableUrl()}?${params}`, { signal })) as {
    records: AirtableRecord[];
  };
  return page.records[0] ? toLink(page.records[0]) : null;
}

export async function createTrackingLink(
  link: NewTrackingLink,
): Promise<TrackingLink> {
  const fields: Record<string, unknown> = {
    Slug: link.slug,
    Destination: link.destination,
    Source: link.source,
    Medium: link.medium,
    Campaign: link.campaign,
    "Created By": link.createdBy,
    Active: true,
  };
  if (link.placement) fields.Placement = link.placement;
  if (link.internalName) fields["Internal Name"] = link.internalName;
  const created = (await airtable(tableUrl(), {
    method: "POST",
    // typecast: a new Source value becomes a choice instead of a 422.
    body: JSON.stringify({ records: [{ fields }], typecast: true }),
  })) as { records: AirtableRecord[] };
  return toLink(created.records[0]);
}

const FIELD_NAMES: Record<UtmSelectField, string> = {
  source: "Source",
  medium: "Medium",
  campaign: "Campaign",
  placement: "Placement",
};
const SCHEMA_TTL_SECONDS = 300;
const CRM_NAME_FIELD = "Server Name";

type MetaField = {
  name: string;
  options?: { choices?: { name: string }[] };
};

const cached = (): RequestInit => ({
  headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` },
  next: { revalidate: SCHEMA_TTL_SECONDS },
});

/**
 * Choice lists of the select columns; placement also offers every Discord server
 * from the outreach CRM. Throws when Airtable can't be read: there's no sensible
 * stand-in for the lists.
 */
export async function loadLinkOptions(): Promise<LinkOptions> {
  if (!env.AIRTABLE_API_KEY) throw new Error("Airtable is not configured");
  const [schemaRes, crmRes] = await Promise.all([
    fetch(
      `https://api.airtable.com/v0/meta/bases/${airtableConfig.baseId}/tables`,
      cached(),
    ),
    fetch(
      `https://api.airtable.com/v0/${airtableConfig.baseId}/${encodeURIComponent(airtableConfig.discordOutreachTableId)}?${new URLSearchParams(
        { "fields[]": CRM_NAME_FIELD, pageSize: "100" },
      )}`,
      cached(),
    ),
  ]);
  if (!schemaRes.ok)
    throw new Error(`Airtable schema read failed (${schemaRes.status})`);
  if (!crmRes.ok)
    throw new Error(`Discord Outreach CRM read failed (${crmRes.status})`);

  const { tables } = (await schemaRes.json()) as {
    tables: { id: string; fields: MetaField[] }[];
  };
  const table = tables.find(
    (t) => t.id === airtableConfig.trackingLinksTableId,
  );
  if (!table) throw new Error("Tracking Links table not found in schema");
  const choices = (field: UtmSelectField) =>
    table.fields
      .find((f) => f.name === FIELD_NAMES[field])
      ?.options?.choices?.map((c) => c.name) ?? [];

  const crm = (await crmRes.json()) as { records: AirtableRecord[] };
  const servers = crm.records
    .map((r) => r.fields[CRM_NAME_FIELD])
    .filter((v): v is string => typeof v === "string" && v.trim() !== "");
  const placement = choices("placement");
  const seen = new Set(placement.map((p) => p.toLowerCase()));
  for (const s of servers) {
    if (!seen.has(s.toLowerCase())) {
      placement.push(s);
      seen.add(s.toLowerCase());
    }
  }

  return {
    source: choices("source"),
    medium: choices("medium"),
    campaign: choices("campaign"),
    placement,
  };
}

// Redirect lookups are cached briefly per server instance: a link posted in a
// busy channel gets a burst of preview-bot hits, and Airtable's rate limit is
// 5 req/s per base. Concurrent misses share one lookup, and a stalled one gives
// up so /go can fall back to the homepage; failures aren't cached.
const CACHE_TTL_MS = 60_000;
const LOOKUP_TIMEOUT_MS = 5_000;
const cache = new Map<string, { at: number; link: TrackingLink | null }>();
const inFlight = new Map<string, Promise<TrackingLink | null>>();

export async function resolveTrackingLink(
  slug: string,
): Promise<TrackingLink | null> {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.link;
  const pending = inFlight.get(slug);
  if (pending) return pending;
  const lookup = findTrackingLink(slug, AbortSignal.timeout(LOOKUP_TIMEOUT_MS))
    .then((link) => {
      cache.set(slug, { at: Date.now(), link });
      return link;
    })
    .finally(() => inFlight.delete(slug));
  inFlight.set(slug, lookup);
  return lookup;
}
