// The /api/admin reference: one entry per route handler, rendered as the
// /backstage/api-docs page and as the markdown agent guide. api-docs.test.ts
// checks each entry's method and permission against the route files.

import {
  megagameIntegrationLevel,
  sessionPhase,
  sessionVerdict,
  speakerTier,
} from "@/db/schema";
import { RUBRIC_KEYS, SESSION_TEXT_KEYS } from "./grade-input";
import { PURPOSES } from "./promo-codes";
import {
  DROPINS_LABELS,
  GRADER_VERDICT_LABELS,
  POTENTIAL_PANEL_LABELS,
  RUBRIC_GRADE_LABELS,
  SHEPHERD_MATCH_LABELS,
  TOPIC_AREA_LABELS,
} from "./rfp-labels";
import { AGES, CATEGORIES, LOCATION_VISIBILITIES, STATUSES } from "./schedule";
import { PERMISSIONS, type Permission } from "./permissions";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type Field = {
  name: string;
  type: string;
  required?: boolean;
  note?: string;
};

export type Endpoint = {
  method: Method;
  /** Path parameters in braces, e.g. /api/admin/schedule/sessions/{slug}. */
  path: string;
  permission: Permission;
  summary: string;
  query?: Field[];
  body?: Field[];
  /** The body isn't JSON. */
  bodyType?: string;
  response: string;
};

export type Area = { title: string; blurb?: string; endpoints: Endpoint[] };

export const API_KEY_HEADER = "x-api-key";

const oneOf = (values: readonly string[]) =>
  values.map((v) => `"${v}"`).join(" | ");
const keys = (labels: Record<string, string>) => oneOf(Object.keys(labels));

const SESSION_FIELDS: Field[] = [
  { name: "title", type: "string", required: true },
  {
    name: "slug",
    type: "string",
    note: "Defaults to the title, slugified. On PUT/PATCH, renames the session.",
  },
  { name: "description", type: "string | null" },
  { name: "category", type: oneOf(CATEGORIES) },
  {
    name: "startsAt",
    type: "string | null",
    note: 'Pacific wall-clock time, "2026-11-06T14:00" (not UTC). Set both times or neither; the session must end after it starts and by midnight that day.',
  },
  { name: "endsAt", type: "string | null", note: "As startsAt." },
  {
    name: "locationId",
    type: "string | null",
    note: "A location id. Overlapping another session there still saves, but adds a warning to the response's `warnings` (rooms with volunteer visibility are exempt).",
  },
  { name: "maxCapacity", type: "integer | null" },
  { name: "minCapacity", type: "integer | null" },
  { name: "ages", type: oneOf(AGES) },
  {
    name: "needs",
    type: "string | null",
    note: "Space and supply needs, free text.",
  },
  {
    name: "status",
    type: oneOf(STATUSES),
    note: 'Default "draft". Published needs both times.',
  },
  {
    name: "rsvpIsCommitment",
    type: "boolean",
    note: "Default false. RSVPs claim a limited spot people rely on; attendees confirm first.",
  },
  {
    name: "sponsored",
    type: "boolean",
    note: "Default false. Tags it Sponsor on the schedule.",
  },
  {
    name: "hosts",
    type: "{email, name?}[]",
    note: "Lead first. An email with no account needs a name, which creates the account.",
  },
  {
    name: "shepherd",
    type: "{email, name?} | null",
    note: "Or send shepherdUserId (string | null) instead.",
  },
  {
    name: "airtableRfpRecordId",
    type: "string | null",
    note: "rec followed by 14 letters or digits.",
  },
];

const LOCATION_FIELDS: Field[] = [
  { name: "name", type: "string", required: true },
  { name: "capacity", type: "integer | null" },
  { name: "campusLocation", type: "string | null" },
  { name: "description", type: "string | null" },
  { name: "displayOrder", type: "integer", note: "Default 100." },
  {
    name: "visibility",
    type: oneOf(LOCATION_VISIBILITIES),
    note: 'Default "hidden" (team only).',
  },
];

const GRADER_FIELDS: Field[] = [
  {
    name: "graderUserId",
    type: "string",
    note: "Or graderEmail; not both. Must be on the speaker committee.",
  },
  { name: "graderEmail", type: "string" },
];

const GRADE_FIELDS: Field[] = [
  ...RUBRIC_KEYS.map((name) => ({
    name,
    type: `${keys(RUBRIC_GRADE_LABELS)} | null`,
  })),
  {
    name: "verdictRecommendation",
    type: `${keys(GRADER_VERDICT_LABELS)} | null`,
  },
  { name: "qualityNotes", type: "string | null" },
  { name: "schedulerNotes", type: "string | null" },
  { name: "shepherdMatch", type: `${keys(SHEPHERD_MATCH_LABELS)} | null` },
  { name: "topicAreas", type: `(${keys(TOPIC_AREA_LABELS)})[]` },
  { name: "potentialPanels", type: `(${keys(POTENTIAL_PANEL_LABELS)})[]` },
  { name: "megagameIntegration", type: "string | null" },
  { name: "expectedCrowdSize", type: "integer 0–10000 | null" },
  { name: "allowDropins", type: `${keys(DROPINS_LABELS)} | null` },
  {
    name: "spaceOptions",
    type: "string[]",
    note: "Location ids from spaceOptions on GET /api/admin/sessions/{id}.",
  },
  {
    name: "advance",
    type: "boolean",
    note: "Moves a session still in grading on to the committee.",
  },
  { name: "communicationNotes", type: "string | null" },
  { name: "housingStatus", type: "string | null" },
  { name: "ticketState", type: "string | null" },
  ...GRADER_FIELDS.map((f) => ({
    ...f,
    note:
      f.note &&
      `${f.note} Defaults to the key's owner; naming anyone else is admin-only.`,
  })),
];

const EMAIL_BODY: Field[] = [{ name: "email", type: "string", required: true }];

/** Shapes several responses share, named in the endpoint responses. */
export const TYPES: { name: string; shape: string }[] = [
  {
    name: "Account",
    shape: "{ userId, name, email }",
  },
  {
    name: "Location",
    shape: `{ id, name, capacity: number | null, campusLocation, description, displayOrder: number, visibility: ${oneOf(LOCATION_VISIBILITIES)}, thumbnailUrl, imageUrl }`,
  },
  {
    name: "Session",
    shape: `{ id, slug, title, description, category, startsAt, endsAt, locationId, maxCapacity, minCapacity, ages, needs, status: ${oneOf(STATUSES)}, rsvpIsCommitment, sponsored, airtableRfpRecordId, hosts: Account[], shepherd: Account | null }. startsAt/endsAt are ISO UTC here, null while a draft is unplaced.`,
  },
  {
    name: "RfpSession",
    shape:
      "{ sessionId, recordId, slug, title, hosts: (Account & {committeeName, discordHandle, website, imageUrl})[], phase, nextSteps, verdict, shepherd, grades: Grade[], grader, row }. row is the whole sessions row: RFP answers and committee notes.",
  },
  {
    name: "Grade",
    shape:
      "The grade fields below, plus { grader: Account & {committeeName}, spaceOptions: {locationId, name}[], submittedAt: string | null, createdAt, updatedAt }. submittedAt is null while the grade is only an assignment.",
  },
];

export const API_AREAS: Area[] = [
  {
    title: "Schedule",
    blurb: "Rooms and sessions on the 2026 program.",
    endpoints: [
      {
        method: "GET",
        path: "/api/admin/schedule",
        permission: "schedule.view",
        summary:
          "The whole schedule: every room, and every session (drafts included) with its hosts, needs and RSVP counts.",
        response:
          "{ locations: Location[], sessions: (Session & { rsvps: {going, waitlist} })[] }",
      },
      {
        method: "GET",
        path: "/api/admin/schedule/sessions/{slug}",
        permission: "schedule.view",
        summary: "One session.",
        response: "{ session: Session }",
      },
      {
        method: "POST",
        path: "/api/admin/schedule/sessions",
        permission: "schedule.manage",
        summary: "Creates a session. 409 if the slug is taken.",
        body: SESSION_FIELDS,
        response: "201 { session: Session, warnings: string[] }",
      },
      {
        method: "PUT",
        path: "/api/admin/schedule/sessions/{slug}",
        permission: "schedule.manage",
        summary:
          "Replaces the session: fields left out are cleared, as the form would.",
        body: SESSION_FIELDS,
        response: "{ session: Session, warnings: string[] }",
      },
      {
        method: "PATCH",
        path: "/api/admin/schedule/sessions/{slug}",
        permission: "schedule.manage",
        summary:
          "Changes only the fields given (title is then optional); hosts or shepherd left out are kept.",
        body: SESSION_FIELDS,
        response: "{ session: Session, warnings: string[] }",
      },
      {
        method: "DELETE",
        path: "/api/admin/schedule/sessions/{slug}",
        permission: "schedule.manage",
        summary: "Deletes the session.",
        response: "{ ok: true }",
      },
      {
        method: "GET",
        path: "/api/admin/schedule/sessions/{slug}/rsvps",
        permission: "schedule.manage",
        summary: "Going and waitlisted accounts, earliest first.",
        response: "{ going: Account[], waitlist: Account[] }",
      },
      {
        method: "POST",
        path: "/api/admin/schedule/sessions/{slug}/rsvps",
        permission: "schedule.manage",
        summary:
          "RSVPs an account, or waitlists it when the session is full. An unknown email plus a name creates the account.",
        body: [...EMAIL_BODY, { name: "name", type: "string" }],
        response: '{ status: "going" | "waitlist" }',
      },
      {
        method: "DELETE",
        path: "/api/admin/schedule/sessions/{slug}/rsvps",
        permission: "schedule.manage",
        summary: "Cancels an account's RSVP.",
        body: EMAIL_BODY,
        response: "{ ok: true }",
      },
      {
        method: "GET",
        path: "/api/admin/schedule/sessions/{slug}/bookmarks",
        permission: "schedule.manage",
        summary: "Accounts that bookmarked the session.",
        response: "{ bookmarkedBy: Account[] }",
      },
      {
        method: "GET",
        path: "/api/admin/schedule/plans",
        permission: "schedule.manage",
        summary: "One account's RSVPs and bookmarks.",
        query: [{ name: "email", type: "string", required: true }],
        response:
          "{ account: Account, rsvps: {slug, title, status}[], bookmarks: {slug, title}[] }",
      },
      {
        method: "POST",
        path: "/api/admin/schedule/locations",
        permission: "schedule.manage",
        summary: "Creates a room. Images go through the image endpoint.",
        body: LOCATION_FIELDS,
        response: "201 { location: Location }",
      },
      {
        method: "PATCH",
        path: "/api/admin/schedule/locations/{id}",
        permission: "schedule.manage",
        summary:
          "Changes only the fields given (name is then optional). Images stay as they are.",
        body: LOCATION_FIELDS,
        response: "{ location: Location }",
      },
      {
        method: "PUT",
        path: "/api/admin/schedule/locations/{id}/image",
        permission: "schedule.manage",
        summary:
          "Uploads the room's images. Nothing is resized, so send both already sized; a part left out keeps what's stored.",
        bodyType: "multipart/form-data",
        body: [
          { name: "thumbnail", type: "file", note: "About 320px wide." },
          { name: "image", type: "file", note: "About 1600px wide." },
        ],
        response: "{ location: Location }",
      },
      {
        method: "DELETE",
        path: "/api/admin/schedule/locations/{id}/image",
        permission: "schedule.manage",
        summary: "Removes both images.",
        response: "{ location: Location }",
      },
    ],
  },
  {
    title: "Speaker committee",
    blurb:
      "Proposals in the RFP pipeline. {id} takes a session id, slug or Airtable record id.",
    endpoints: [
      {
        method: "GET",
        path: "/api/admin/sessions",
        permission: "schedule.manage",
        summary:
          "Sessions in the RFP pipeline with hosts, shepherd and grades.",
        query: [
          {
            name: "phase",
            type: oneOf([...sessionPhase.enumValues, "none"]),
            note: 'Comma-separated or repeated; matches any. "none" matches unset.',
          },
          {
            name: "verdict",
            type: oneOf([...sessionVerdict.enumValues, "none"]),
            note: "As phase.",
          },
          { name: "grader", type: "string", note: "A user id or email." },
          { name: "shepherd", type: "string", note: "A user id or email." },
        ],
        response: "{ sessions: RfpSession[] }",
      },
      {
        method: "GET",
        path: "/api/admin/sessions/{id}",
        permission: "schedule.manage",
        summary: "One session, plus the rooms a grade can suggest.",
        response: "{ session: RfpSession, spaceOptions: {id, name, label}[] }",
      },
      {
        method: "PATCH",
        path: "/api/admin/sessions/{id}",
        permission: "schedule.manage",
        summary:
          "Changes only the fields given; null clears one. Unknown fields are refused.",
        body: [
          { name: "phase", type: `${oneOf(sessionPhase.enumValues)} | null` },
          {
            name: "verdict",
            type: `${oneOf(sessionVerdict.enumValues)} | null`,
          },
          {
            name: "speakerTier",
            type: `${oneOf(speakerTier.enumValues)} | null`,
          },
          {
            name: "megagameIntegrationLevel",
            type: `${oneOf(megagameIntegrationLevel.enumValues)} | null`,
          },
          {
            name: "shepherdUserId",
            type: "string | null",
            note: "Or shepherdEmail; not both.",
          },
          { name: "shepherdEmail", type: "string | null" },
          ...SESSION_TEXT_KEYS.map((name) => ({
            name,
            type: "string | null",
          })),
        ],
        response: "{ session: RfpSession }",
      },
      {
        method: "PUT",
        path: "/api/admin/sessions/{id}/grade",
        permission: "submissions.grade",
        summary:
          "Saves a whole grade, replacing the grader's own: fields left out are cleared. 409 if the session isn't in the pipeline.",
        body: GRADE_FIELDS,
        response: "{ session: RfpSession }",
      },
      {
        method: "PATCH",
        path: "/api/admin/sessions/{id}/grade",
        permission: "submissions.grade",
        summary:
          "Edits the grader's existing grade: only the fields given change. 404 if they have none yet.",
        body: GRADE_FIELDS,
        response: "{ session: RfpSession }",
      },
      {
        method: "POST",
        path: "/api/admin/sessions/{id}/graders",
        permission: "schedule.manage",
        summary:
          "Assigns a committee member to grade the session. A no-op if already assigned.",
        body: GRADER_FIELDS,
        response: "{ session: RfpSession }",
      },
      {
        method: "DELETE",
        path: "/api/admin/sessions/{id}/graders",
        permission: "schedule.manage",
        summary:
          "Takes back an assignment: 404 without one, 409 once the grade is submitted.",
        body: GRADER_FIELDS,
        response: "{ session: RfpSession }",
      },
      {
        method: "POST",
        path: "/api/admin/rfp-intake",
        permission: "schedule.manage",
        summary:
          "Makes the draft session for an RFP Submissions row, read from Airtable. A re-send fills only empty columns. Used by the Airtable automation.",
        body: [
          {
            name: "recordId",
            type: "string",
            required: true,
            note: "An Airtable record id.",
          },
        ],
        response:
          "201 or 200 { sessionId, slug, created: boolean, filled: string[], hostUserId, warnings: string[] }",
      },
    ],
  },
  {
    title: "Promo codes",
    blurb: "Comp and discount codes on Stripe.",
    endpoints: [
      {
        method: "GET",
        path: "/api/admin/promo",
        permission: "promo.view",
        summary:
          "Without code: every code the promo tool minted, newest first. With code: whether it exists.",
        query: [{ name: "code", type: "string" }],
        response:
          "{ codes: {id, code, name, email, purpose, notes, redeemed, max, active, created, coupon}[] } or { exists: boolean, id?, active?, couponId? }",
      },
      {
        method: "GET",
        path: "/api/admin/promo/coupons",
        permission: "promo.view",
        summary: "The coupons a code can be minted on.",
        response:
          '{ coupons: {id, label, kind: "percent" | "amount", amountOff?, currency?, percentOff?, isDefault}[] }',
      },
      {
        method: "POST",
        path: "/api/admin/promo",
        permission: "promo.create",
        summary:
          "Mints one code. Send couponId or amountOffUsd, never neither. 409 if customCode exists.",
        body: [
          { name: "name", type: "string", required: true },
          { name: "purpose", type: oneOf(PURPOSES), required: true },
          {
            name: "couponId",
            type: "string",
            note: "From /api/admin/promo/coupons.",
          },
          {
            name: "amountOffUsd",
            type: "number",
            note: "Resolves to the one active coupon taking that much off.",
          },
          {
            name: "customCode",
            type: "string",
            note: "Letters, digits and dashes.",
          },
          {
            name: "maxUses",
            type: "integer | null",
            note: "Null or left out is unlimited.",
          },
          { name: "email", type: "string" },
          { name: "notes", type: "string" },
        ],
        response:
          "201, or 200 with reused: true when the same guest already had that code { code, id, active, couponId, max, test, reused? }",
      },
    ],
  },
  {
    title: "Tracking links",
    blurb: "Short /go/ links with UTM attribution, stored in Airtable.",
    endpoints: [
      {
        method: "GET",
        path: "/api/admin/links",
        permission: "links.manage",
        summary: "Every short link, newest first.",
        response:
          "{ links: {id, slug, destination, source, medium, campaign, placement, internalName, createdBy, createdAt, active, template, shortUrl}[] }",
      },
      {
        method: "POST",
        path: "/api/admin/links",
        permission: "links.manage",
        summary:
          "Creates a link. UTM values snap to Airtable's spelling. 409 with the existing link if the slug is taken.",
        body: [
          {
            name: "destination",
            type: "string",
            required: true,
            note: "An https link on this site.",
          },
          {
            name: "slug",
            type: "string",
            required: true,
            note: "3–48 lowercase letters, digits and hyphens.",
          },
          { name: "source", type: "string", required: true },
          { name: "medium", type: "string", required: true },
          { name: "placement", type: "string", required: true },
          {
            name: "campaign",
            type: "string",
            note: "Must be an existing choice; defaults to the form's.",
          },
          { name: "internalName", type: "string" },
        ],
        response: "201 { slug, shortUrl, destination }",
      },
    ],
  },
  {
    title: "Docs",
    endpoints: [
      {
        method: "GET",
        path: "/api/admin/docs",
        permission: "api_docs.view",
        summary: "This guide, as markdown.",
        response: "text/markdown",
      },
    ],
  },
];

const fieldLine = (f: Field) =>
  `- \`${f.name}\` (${f.type}${f.required ? ", required" : ""})${f.note ? ` ${f.note}` : ""}`;

/** The whole reference as markdown, to hand to an agent. */
export function apiGuideMarkdown(origin: string): string {
  const out: string[] = [
    "# Metagame admin API",
    "",
    "Instructions for an agent using the Metagame admin API.",
    "",
    "## Basics",
    "",
    `- Base URL: ${origin}`,
    `- Send the API key in the \`${API_KEY_HEADER}\` header on every request. The key acts as the account that minted it, so each endpoint needs that account to hold the permission listed.`,
    "- Bodies are JSON (`content-type: application/json`) unless noted.",
    "- Errors are `{ error, field? }`: 400 invalid input (`field` names it), 401 missing or invalid key, 403 the key's account lacks the permission, 404 not found, 409 conflict, 500 couldn't save, 502/503 Stripe or Airtable trouble.",
    "- Session times are sent as Pacific wall-clock strings and returned as ISO UTC.",
    "- GETs are safe. Everything else changes live data that attendees and staff see: confirm with the person you're working for before writing, and never retry a write blindly.",
    "",
    "## Shared shapes",
    "",
    ...TYPES.map((t) => `- **${t.name}**: ${t.shape}`),
  ];
  for (const area of API_AREAS) {
    out.push("", `## ${area.title}`);
    if (area.blurb) out.push("", area.blurb);
    for (const e of area.endpoints) {
      out.push(
        "",
        `### ${e.method} ${e.path}`,
        "",
        e.summary,
        "",
        `Permission: \`${e.permission}\` (${PERMISSIONS[e.permission].label})`,
      );
      if (e.query?.length) out.push("", "Query:", ...e.query.map(fieldLine));
      if (e.body?.length)
        out.push(
          "",
          `Body${e.bodyType ? ` (${e.bodyType})` : ""}:`,
          ...e.body.map(fieldLine),
        );
      out.push("", `Response: ${e.response}`);
    }
  }
  return out.join("\n") + "\n";
}
