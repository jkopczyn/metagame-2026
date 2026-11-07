import { describe, expect, it } from "vitest";
import { describeSchema } from "./describe";

const info = describeSchema();
const table = (name: string) => {
  const t = info.tables.find((t) => t.name === name);
  if (!t) throw new Error(`no table ${name}`);
  return t;
};
const column = (tableName: string, name: string) => {
  const c = table(tableName).columns.find((c) => c.name === name);
  if (!c) throw new Error(`no column ${tableName}.${name}`);
  return c;
};

describe("describeSchema", () => {
  it("lists every table once", () => {
    expect(info.tables.map((t) => t.name).sort()).toEqual([
      "account",
      "apikey",
      "bookmarks",
      "budget_ignored_lines",
      "budget_import_runs",
      "hat_schedule",
      "hat_steals",
      "level_events",
      "locations",
      "profiles",
      "quest_progress",
      "quests",
      "role_permissions",
      "roles",
      "rsvps",
      "session",
      "session_grade_space_options",
      "session_grades",
      "session_hosts",
      "sessions",
      "sign_drafts",
      "tickets",
      "unconference_note_reactions",
      "unconference_notes",
      "user",
      "user_permission_grants",
      "user_roles",
      "verification",
      "xero_connections",
    ]);
  });

  it("reports column names in snake_case, matching the migration", () => {
    expect(column("user", "email_verified").type).toBe("boolean");
    expect(column("account", "access_token_expires_at").type).toBe(
      "timestamp with time zone",
    );
  });

  it("follows foreign keys to the user table with cascade deletes", () => {
    expect(column("session", "user_id").references).toEqual({
      table: "user",
      column: "id",
      onDelete: "cascade",
    });
    expect(
      table("user")
        .referencedBy.map((r) => r.table)
        .sort(),
    ).toEqual([
      "account",
      "apikey",
      "bookmarks",
      "hat_schedule",
      "hat_steals",
      "hat_steals",
      "level_events",
      "level_events",
      "level_events",
      "profiles",
      "quest_progress",
      "quest_progress",
      "quest_progress",
      "rsvps",
      "session",
      "session_grades",
      "session_hosts",
      "sessions",
      "sign_drafts",
      "sign_drafts",
      "tickets",
      "tickets",
      "tickets",
      "tickets",
      "unconference_note_reactions",
      "unconference_notes",
      "user_permission_grants",
      "user_roles",
    ]);
    expect(column("tickets", "owner_user_id").references?.onDelete).toBe(
      "set null",
    );
    expect(column("tickets", "holder_user_id").references?.onDelete).toBe(
      "set null",
    );
    expect(column("sessions", "shepherd_user_id").references?.onDelete).toBe(
      "set null",
    );
  });

  it("exposes defaults, including the admin-plugin role", () => {
    const role = column("user", "role");
    expect(role.type).toBe("text");
    expect(role.nullable).toBe(false);
    expect(role.default).toBe("'user'");
    expect(column("user", "banned").default).toBe("false");
    expect(column("user", "created_at").default).toBe("now()");
    expect(column("session", "impersonated_by").nullable).toBe(true);
    expect(table("profiles").columns.map((c) => c.name)).not.toContain("role");
    expect(info.enums.map((e) => e.name)).toEqual([
      "ticket_source",
      "ticket_status",
      "session_category",
      "session_ages",
      "session_status",
      "rsvp_status",
      "session_phase",
      "session_verdict",
      "speaker_tier",
      "megagame_integration_level",
      "megagame_interest",
      "session_dropins",
      "discord_status",
      "location_visibility",
      "unconference_note_color",
      "rubric_grade",
      "shepherd_match",
      "topic_area",
      "potential_panel",
    ]);
  });

  it("keeps one grade per grader and links grades to rooms", () => {
    expect(column("session_grades", "session_id").references).toEqual({
      table: "sessions",
      column: "id",
      onDelete: "cascade",
    });
    expect(column("session_grades", "submitted_at").nullable).toBe(true);
    expect(column("session_grades", "topic_areas").type).toBe("topic_area[]");
    expect(
      column("session_grade_space_options", "location_id").references?.table,
    ).toBe("locations");
    expect(column("sessions", "phase").nullable).toBe(true);
    expect(column("sessions", "verdict").nullable).toBe(true);
  });

  it("hangs unconference notes off a room and an account, both cascading", () => {
    expect(column("unconference_notes", "location_id").references).toEqual({
      table: "locations",
      column: "id",
      onDelete: "cascade",
    });
    expect(
      column("unconference_notes", "author_user_id").references?.onDelete,
    ).toBe("cascade");
    expect(column("unconference_notes", "x").type).toBe("real");
    expect(column("unconference_notes", "x").default).toBe("0");
    expect(column("unconference_notes", "board_day").type).toBe("date");
    expect(column("locations", "board_starts_at").type).toBe(
      "timestamp with time zone",
    );
  });

  it("marks keys and uniqueness", () => {
    expect(column("user", "id").primary).toBe(true);
    expect(column("user", "email").unique).toBe(true);
    expect(column("session", "token").unique).toBe(true);
    expect(table("session").indexes).toEqual([
      { name: "session_user_id_idx", columns: ["user_id"], unique: false },
    ]);
  });

  it("has a note and a group for every table", () => {
    for (const t of info.tables) {
      expect(t.note, t.name).not.toBe("");
      expect(t.group, t.name).not.toBe("Other");
    }
  });

  it("groups tables in display order without losing any", () => {
    expect(info.groups.map((g) => g.name)).toEqual([
      "Auth (managed by Better Auth)",
      "Access",
      "Attendees",
      "Tickets",
      "Schedule",
      "Grading",
      "Budget",
      "Megagame",
      "Signs",
    ]);
    expect(info.groups.flatMap((g) => g.tables.map((t) => t.name))).toEqual([
      "user",
      "session",
      "account",
      "verification",
      "apikey",
      "roles",
      "role_permissions",
      "user_roles",
      "user_permission_grants",
      "profiles",
      "tickets",
      "locations",
      "sessions",
      "session_hosts",
      "rsvps",
      "bookmarks",
      "unconference_notes",
      "unconference_note_reactions",
      "session_grades",
      "session_grade_space_options",
      "xero_connections",
      "budget_import_runs",
      "budget_ignored_lines",
      "quests",
      "quest_progress",
      "level_events",
      "hat_steals",
      "hat_schedule",
      "sign_drafts",
    ]);
  });

  it("records hat thefts against the thief and the volunteer", () => {
    expect(table("hat_steals").columns.map((c) => c.name)).toEqual([
      "id",
      "hat_id",
      "user_id",
      "stolen_at",
      "recorded_by",
      "created_at",
    ]);
    expect(column("hat_steals", "id").primary).toBe(true);
    expect(column("hat_steals", "hat_id").nullable).toBe(false);
    expect(column("hat_steals", "user_id").nullable).toBe(false);
    expect(column("hat_steals", "stolen_at").nullable).toBe(false);
    expect(column("hat_steals", "created_at").nullable).toBe(false);
    expect(column("hat_steals", "recorded_by").nullable).toBe(true);
    expect(column("hat_steals", "user_id").references).toEqual({
      table: "user",
      column: "id",
      onDelete: "cascade",
    });
    expect(column("hat_steals", "recorded_by").references).toEqual({
      table: "user",
      column: "id",
      onDelete: "set null",
    });
    expect(table("hat_steals").indexes).toEqual([
      {
        name: "hat_steals_hat_stolen_at_idx",
        columns: ["hat_id", "stolen_at"],
        unique: false,
      },
    ]);
  });

  it("keeps megagame history when a quest or account goes away", () => {
    expect(column("quest_progress", "quest_id").references?.onDelete).toBe(
      "restrict",
    );
    expect(column("quest_progress", "user_id").references?.onDelete).toBe(
      "cascade",
    );
    expect(column("quest_progress", "confirmed_by").references?.onDelete).toBe(
      "set null",
    );
    expect(column("quest_progress", "undone_by").references?.onDelete).toBe(
      "set null",
    );
    expect(column("quest_progress", "undone_at").nullable).toBe(true);
    expect(column("quest_progress", "undo_reason").type).toBe("text");
    expect(table("quest_progress").columns.map((c) => c.name)).not.toContain(
      "confirmation_id",
    );
    expect(column("level_events", "user_id").references?.onDelete).toBe(
      "set null",
    );
    expect(column("quests", "body_images").type).toBe("text[]");
    expect(column("quests", "min_players").nullable).toBe(false);
    expect(column("quests", "stamps_any").nullable).toBe(false);
    expect(column("quests", "evidence_image").nullable).toBe(true);
    expect(table("quests").columns.map((c) => c.name)).not.toContain("kind");
    expect(
      table("quest_progress").indexes.find(
        (i) => i.name === "quest_progress_user_quest_unique",
      ),
    ).toEqual({
      name: "quest_progress_user_quest_unique",
      columns: ["user_id", "quest_id"],
      unique: true,
    });
    expect(
      table("level_events").indexes.find(
        (i) => i.name === "level_events_live_unique",
      ),
    ).toEqual({
      name: "level_events_live_unique",
      columns: ["user_id", "class", "level"],
      unique: true,
    });
  });
});
