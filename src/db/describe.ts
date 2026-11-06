import { is, SQL, StringChunk } from "drizzle-orm";
import { toSnakeCase } from "drizzle-orm/casing";
import {
  getTableConfig,
  isPgEnum,
  PgTable,
  type PgColumn,
} from "drizzle-orm/pg-core";
import * as schema from "./schema";

// Plain-data description of the Drizzle schema, derived from the same table
// objects the app queries with, so /backstage/schema can never drift from the code.

export type ColumnInfo = {
  name: string;
  type: string;
  nullable: boolean;
  primary: boolean;
  unique: boolean;
  default: string | null;
  enumValues: string[] | null;
  references: { table: string; column: string; onDelete: string } | null;
};

export type IndexInfo = { name: string; columns: string[]; unique: boolean };

export type TableInfo = {
  name: string;
  group: string;
  note: string;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  referencedBy: { table: string; column: string }[];
};

export type EnumInfo = { name: string; values: string[] };

export type SchemaInfo = {
  groups: { name: string; tables: TableInfo[] }[];
  tables: TableInfo[];
  enums: EnumInfo[];
};

// Which area each table belongs to, in display order. A table missing here
// lands in "Other" so it still shows up (and the test flags it).
const TABLE_GROUPS: Record<string, string[]> = {
  "Auth (managed by Better Auth)": [
    "user",
    "session",
    "account",
    "verification",
    "apikey",
  ],
  Access: ["roles", "role_permissions", "user_roles", "user_permission_grants"],
  Attendees: ["profiles"],
  Tickets: ["tickets"],
  Schedule: [
    "locations",
    "sessions",
    "session_hosts",
    "rsvps",
    "bookmarks",
    "unconference_notes",
    "unconference_note_reactions",
  ],
  Grading: ["session_grades", "session_grade_space_options"],
  Budget: ["xero_connections", "budget_import_runs", "budget_ignored_lines"],
  Megagame: ["quests", "quest_progress", "level_events"],
  Signs: ["sign_drafts"],
};

// What each table is for, in one line. Reviewed alongside the columns.
const TABLE_NOTES: Record<string, string> = {
  user: "One row per account. Owned by Better Auth; email is the login identifier and is unique. role (user | admin) and the ban fields come from the admin plugin and can't be changed through the normal account-update path; admin is the break-glass superuser that bypasses the permission system (roles, user_permission_grants) and is only set by SQL.",
  session:
    "Signed-in browser sessions. Deleting a user removes their sessions (cascade).",
  account:
    "How a user can sign in: one row per method. The credential provider's row holds the password hash; OAuth providers would hold tokens.",
  verification:
    "Short-lived email codes and similar one-time secrets, keyed by identifier (the email).",
  apikey:
    "API keys (Better Auth api-key plugin), minted on /backstage/api-keys. A request carrying one in x-api-key acts as the owning user (reference_id), so the permission gates apply as they do to pages. Only the hash is stored; start shows the first characters for telling keys apart.",
  roles:
    "Bundles of permissions handed out on /backstage/roles (e.g. Volunteer). Which permissions exist is the catalog in src/lib/permissions.ts, not a table.",
  role_permissions:
    "The permission keys a role grants, one row each. Text, not an enum, so adding a permission to the catalog needs no migration.",
  user_roles: "Which roles each account holds. One row per pair.",
  user_permission_grants:
    "Permissions an account holds on top of its roles, one row each. Grants only: there is no deny.",
  profiles:
    'Attendee-editable profile fields, kept apart from user so nothing security-relevant sits next to a form field. image_url is the profile picture, a 512px Vercel Blob URL. is_adult ("18 or older?") and bringing_children are the first sign-in modal\'s required answers; it keeps opening while either is null. share_with_recruiters opts in to the name-and-email list sponsors who are hiring receive. website is a link the person gave (a host\'s RFP "Link"). wizard_level, pirate_level and alien_level are the Megagame class levels, 0–5 (check constraints), set from the Megagame tab on /account and the volunteer level-up; level_events is their audit log.',
  tickets:
    "One row per purchase, keyed by the payment id the webhooks upsert on. Airtable keeps the finance detail; this holds what admission needs. owner_user_id (the attendee) is set only by claiming the ticket code, never by email match. holder_user_id is who has the code to pass on or claim; null means the buyer (purchaser_email). purchaser_discord is the Discord handle typed at checkout (leading @ stripped), used to prefill an empty profile Discord. claimed_by is the check-in volunteer who claimed it for the attendee; null for a self-claim. Unclaiming clears the owner, makes them the holder and issues a fresh random code. badge_code is the four-digit number (shown zero-padded) on the QR sticker a check-in volunteer puts on the badge and types in at the desk; null until a volunteer assigns it. checked_in_at and checked_in_by record the check-in (who ran it, null if that account is gone); set when a claimed, paid ticket is checked in, cleared by an undo, and while set the attendee can't unclaim.",
  locations:
    "Rooms and spaces sessions happen in. display_order and visibility (who the room shows up for: everyone, volunteers and team, or team only) drive the schedule columns; board_starts_at and board_ends_at are when the unconference bulletin board takes over the room's column (null end: to the end of the schedule); sessions may still be placed in the room, and the public grid shows them only through a session poster on the board; airtable_record_id ties a room to its Lighthaven Spaces row. thumbnail_url (what the schedule shows) and image_url (a large copy for detail views) are Vercel Blob URLs.",
  sessions:
    "One row per schedule slot. Drafts can be unplaced (null times, no location); only published rows show. rsvp_is_commitment marks a session whose RSVPs claim a limited spot people rely on (attendees confirm before claiming one) rather than a show of interest; sponsored tags it as a sponsor session on the schedule; rsvps_open false greys out the public RSVP button (“RSVPs not yet open”) and refuses RSVPs until the team turns it on. airtable_rfp_record_id ties a session to the accepted RFP it was synced from. shepherd_user_id is the committee member shepherding it (null if none; the name shown is read from the account). Every RFP submission is a session: phase is its stage in the committee pipeline (separate from status), verdict the committee's call, speaker_tier what the host is comped, megagame_integration_level how far it ties into the Megagame (null = undecided; not mirrored to Airtable), and the remaining text columns hold the host's RFP answers and the committee's logistics notes. All of these are admin-only and null for sessions that never came through the RFP.",
  session_hosts:
    "Who runs a session, one row per host in billing order (position 0 is the lead), replacing 2025's host_1/2/3 columns. Every host is an account; the schedule shows the account name.",
  rsvps:
    "Going or waitlisted, one row per user per session. The rsvps_capacity trigger refuses a going row once the session's max_capacity is reached (null = unlimited).",
  bookmarks: "Sessions a user starred. One row per pair.",
  unconference_notes:
    "Notices on the unconference board (the room with locations.board_starts_at set), one row per notice, each on one day's board (board_day, a Pacific date). A row with session_id is a session poster, pinned by the schedule team: drawn full width at that session's time on the day it is on, over every sticky, opening the session; any ticket holder may pin one up, with no committee approval. Each is a sticky note (what the board draws) and a poster (what it opens into), stored as JSON documents of text boxes and pen strokes (src/lib/notice-doc.ts), validated on every write. title is plain text derived from them on save, null for a notice that is only drawings. x and y are fractions of the board, 0 to 1, so it reflows at any width; y is free placement and carries no time. color is the sticky note's paper, from a fixed palette. The author's name is read from the account, never stored here.",
  unconference_note_reactions:
    "Emoji reactions on a notice, one row per person per emoji, Discord-style. Any ticket holder may react; tapping the same emoji again deletes the row.",
  session_grades:
    "One committee member's grade of a proposal, one row per session and grader; re-grading overwrites it. A row with submitted_at null is an assignment not yet graded. topic_areas and potential_panels are multi-selects as enum arrays. Deleting a grader's account is refused while they have grades, since these are the only copy.",
  session_grade_space_options:
    "The rooms a grader thinks would suit the session, one row per grade and location.",
  sign_drafts:
    "Shared drafts from the sign maker at /backstage/signs, one row per sign. sign is the tool's own JSON document (text lines, layers, background); photos and fonts it uses are Vercel Blob URLs, not stored here. thumbnail is a tiny data URL for the list. Anyone with misc.signs sees and may edit every draft; created_by and updated_by are credit, not enforced.",
  xero_connections:
    "The budget tool's Xero OAuth tokens: one row, id \"metagame\". The refresh token rotates on every use, so it needs a writable home; refresh_locked_at serialises concurrent refreshes, since a single-use token can't be exchanged twice. connected_by names who linked the account. The budget itself lives in the Google Sheet, not here.",
  budget_import_runs:
    'One row per Claude call from /backstage/budget: kind "import" (Xero lines proposed into the sheet) or "request" (the Ask Claude box). Holds the outcome counts, the model and its token counts for cost tracking, and the error if it failed.',
  budget_ignored_lines:
    "Xero bank lines the team chose not to import, keyed by the Xero line id so later imports skip them; reason and ignored_by record why and who.",
  quests:
    "Megagame quests. code is the six-character label code printed with its QR. class null means any class, and only a classed quest may carry a min_level/max_level window (check constraint). kind answer checks the players' answer against answers (normalized); kind evidence shows the volunteer the evidence description. Withdraw a quest with active rather than deleting it.",
  quest_progress:
    "One row per player and quest (unique index). A volunteer's confirm at /backstage/megagame sets status to completed with completed_at and confirmed_by; confirming a row that is already completed changes nothing, so a retry is a no-op. Undo sets status back to attempted and fills undone_at, undone_by and undo_reason; nothing is deleted. attempt_count and first_attempt_at come from the answer checker and survive an undo. Deleting the account deletes its rows.",
  level_events:
    "The audit log of Megagame level changes; current levels are the profiles level columns. source is picker (joining a class on /account) or volunteer (the level-up action). A partial unique index allows one live event per player, class and level. checks_passed false with override_reason records a volunteer's \"Yes, I'm sure\". Undo voids the row and recomputes the profile column from what remains.",
};

function columnName(column: PgColumn): string {
  // Matches the snake_case casing set in drizzle.config.ts and src/db/index.ts.
  return column.keyAsName ? toSnakeCase(column.name) : column.name;
}

function renderDefault(column: PgColumn): string | null {
  if (!column.hasDefault) return null;
  const value: unknown = column.default;
  if (value === undefined) return "(generated)";
  if (is(value, SQL)) {
    return value.queryChunks
      .map((chunk) => (is(chunk, StringChunk) ? chunk.value.join("") : "?"))
      .join("");
  }
  if (typeof value === "string") return `'${value}'`;
  return String(value);
}

function indexColumnName(column: unknown): string {
  if (column && typeof column === "object" && "name" in column) {
    const { name, keyAsName } = column as { name: string; keyAsName?: boolean };
    return keyAsName ? toSnakeCase(name) : name;
  }
  return "(expression)";
}

export function describeSchema(): SchemaInfo {
  // Widen first: the module's exact export types defeat the type guards.
  const exports: unknown[] = Object.values(schema);
  const tables = exports.filter((v): v is PgTable => is(v, PgTable));
  const enums: EnumInfo[] = exports
    .filter(isPgEnum)
    .map((e) => ({ name: e.enumName, values: [...e.enumValues] }));

  const configs = tables.map((t) => getTableConfig(t));
  const nameOf = new Map(tables.map((t, i) => [t, configs[i].name]));

  const referencedBy = new Map<string, { table: string; column: string }[]>();
  const info: TableInfo[] = configs.map((cfg) => {
    const fkByColumn = new Map<string, ColumnInfo["references"]>();
    for (const fk of cfg.foreignKeys) {
      const ref = fk.reference();
      const target = nameOf.get(ref.foreignTable) ?? "?";
      ref.columns.forEach((col, i) => {
        const targetColumn = columnName(ref.foreignColumns[i]);
        fkByColumn.set(columnName(col), {
          table: target,
          column: targetColumn,
          onDelete: fk.onDelete ?? "no action",
        });
        const list = referencedBy.get(target) ?? [];
        list.push({ table: cfg.name, column: columnName(col) });
        referencedBy.set(target, list);
      });
    }

    return {
      name: cfg.name,
      group:
        Object.keys(TABLE_GROUPS).find((g) =>
          TABLE_GROUPS[g].includes(cfg.name),
        ) ?? "Other",
      note: TABLE_NOTES[cfg.name] ?? "",
      columns: cfg.columns.map((col) => {
        const name = columnName(col);
        return {
          name,
          type: col.getSQLType(),
          nullable: !col.notNull,
          primary: col.primary,
          unique: col.isUnique,
          default: renderDefault(col),
          enumValues: col.enumValues ? [...col.enumValues] : null,
          references: fkByColumn.get(name) ?? null,
        };
      }),
      indexes: cfg.indexes.map((idx) => ({
        name: idx.config.name ?? "(unnamed)",
        columns: idx.config.columns.map(indexColumnName),
        unique: idx.config.unique,
      })),
      referencedBy: [],
    };
  });

  for (const table of info) {
    table.referencedBy = referencedBy.get(table.name) ?? [];
  }

  const groups = [...Object.keys(TABLE_GROUPS), "Other"]
    .map((name) => ({
      name,
      tables:
        name === "Other"
          ? info.filter((t) => t.group === "Other")
          : TABLE_GROUPS[name].flatMap((t) => info.filter((i) => i.name === t)),
    }))
    .filter((g) => g.tables.length > 0);

  return { groups, tables: info, enums };
}
