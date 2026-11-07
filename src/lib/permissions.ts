// The permission catalog and the pure resolution over it. One entry per gate
// the code enforces; the roles and per-user grants that hold them live in
// Postgres (src/db/schema/permissions.ts) and are read by src/lib/access.ts.
// Adding a gate means adding its key here, nothing else.

/** Display only: how much a permission lets its holder change. */
export type PermissionLevel = "view" | "edit" | "delete";

/**
 * `team`: a team tool, so holding it opens /backstage and the nav's admin link.
 * `attendee`: a site-facing gate ticket holders may get through the built-in
 * Attendee role; on its own it opens nothing under /backstage.
 */
export type PermissionAudience = "team" | "attendee";

// Grouped by area, and within an area in the order view, edit, delete; the
// roles grid renders a heading per group, so labels name the action.
export const PERMISSIONS = {
  "users.view": {
    audience: "team",
    group: "Users",
    level: "view",
    label: "View users",
    description:
      "The account list and each one's roles, permissions and tickets.",
    // Strictly more than the profile page, so the /u link from here works.
    implies: ["profiles.view"],
  },
  "users.create": {
    audience: "team",
    group: "Users",
    level: "edit",
    label: "Create users",
    description:
      "Make an account from a name and email, optionally sending an invite.",
    implies: ["users.view"],
  },
  "users.edit": {
    audience: "team",
    group: "Users",
    level: "edit",
    label: "Edit users",
    description: "Change other accounts' roles and per-user permissions.",
    implies: ["users.view"],
  },
  // Attendee, not team: team audience opens the whole /backstage index via
  // hasTeamPermission(), and this is meant for volunteers on the door.
  "profiles.view": {
    audience: "attendee",
    group: "Profiles",
    level: "view",
    label: "View profiles",
    description:
      "Anyone's /u profile page, including the ones not shown to other attendees.",
  },
  "tickets.view": {
    audience: "team",
    group: "Tickets",
    level: "view",
    label: "View tickets",
    description: "Each ticket with its buyer, holder and attendee.",
  },
  "tickets.edit": {
    audience: "team",
    group: "Tickets",
    level: "edit",
    label: "Edit tickets",
    description:
      "Fix a ticket's badge code or which ticket referred it, after the fact.",
    implies: ["tickets.view"],
  },
  "checkin.manage": {
    audience: "team",
    group: "Check-in",
    level: "edit",
    label: "Run check-in",
    description:
      "Check attendees in at the desk, assign badge numbers, claim a ticket on an attendee's behalf and undo a check-in.",
  },
  // Its own permission, not folded into a role: it exposes parents' contact
  // details and children's medical notes.
  "children.view": {
    audience: "team",
    group: "Childcare",
    level: "view",
    label: "View children",
    description:
      "Every registered child with their parent's contact details and childcare sessions.",
  },
  "schedule.preview": {
    audience: "attendee",
    group: "Schedule",
    level: "view",
    label: "Preview schedule",
    description:
      "Saw the schedule before it opened to everyone; gates nothing now.",
  },
  "schedule.rsvps": {
    audience: "attendee",
    group: "Schedule",
    level: "view",
    label: "RSVP names",
    description:
      "RSVP names on every session page, not just the counts; hosts see them on their own sessions regardless.",
  },
  "schedule.volunteer_rooms": {
    audience: "attendee",
    group: "Schedule",
    level: "view",
    label: "Volunteer rooms",
    description:
      "Rooms marked volunteer-only, such as ops desks, alongside the public ones.",
  },
  // Attendee, not team, like volunteer_rooms: meant for volunteers and hosts
  // who need to know what a session needs, without opening /backstage.
  "schedule.session_notes": {
    audience: "attendee",
    group: "Schedule",
    level: "view",
    label: "Session notes",
    description:
      "A session's needs and shepherd on its schedule page. Not grader notes or grading links.",
  },
  // Read-only API access, e.g. for pulling needs into a supplies list.
  "schedule.view": {
    audience: "team",
    group: "Schedule",
    level: "view",
    label: "View schedule data",
    description:
      "Every session, draft or not, with its needs, over the API. Not RSVP lists.",
    implies: ["schedule.preview", "schedule.volunteer_rooms"],
  },
  "schedule.manage": {
    audience: "team",
    group: "Schedule",
    level: "edit",
    label: "Edit schedule",
    description: "On the admin grid and over the API.",
    implies: ["schedule.view", "schedule.session_notes"],
  },
  // Kept off schedule.manage: column order is one shared view, so only
  // people who know that should move it.
  "schedule.rooms": {
    audience: "team",
    group: "Schedule",
    level: "edit",
    label: "Arrange rooms",
    description: "Drag rooms to reorder the grid's columns for everyone.",
    implies: ["schedule.manage"],
  },
  // Attendee, not team: team audience would open the whole /backstage index
  // via hasTeamPermission(), and every ticket holder gets this one.
  "unconference.post": {
    audience: "attendee",
    group: "Unconference",
    level: "edit",
    label: "Post to the board",
    description:
      "Pin a note on the unconference bulletin board, and edit or remove your own.",
  },
  "promo.view": {
    audience: "team",
    group: "Promo codes",
    level: "view",
    label: "View promo codes",
    description: "The comp and discount codes that exist, with their uses.",
  },
  "promo.create": {
    audience: "team",
    group: "Promo codes",
    level: "edit",
    label: "Mint promo codes",
    description: "Mint new codes on Stripe or BTC.",
    implies: ["promo.view"],
  },
  "promo.manage": {
    audience: "team",
    group: "Promo codes",
    level: "edit",
    label: "Manage promo codes",
    description: "Archive and restore codes, on top of minting them.",
    implies: ["promo.create"],
  },
  "links.manage": {
    audience: "team",
    group: "Tracking links",
    level: "edit",
    label: "Tracking links",
    description: "Short /go/ links with UTM attribution.",
  },
  "budget.view": {
    audience: "team",
    group: "Budget",
    level: "view",
    label: "View budget",
    description:
      "The review queue, plans and import history at /backstage/budget, read-only.",
  },
  "budget.manage": {
    audience: "team",
    group: "Budget",
    level: "edit",
    label: "Manage budget",
    description:
      "Approve or reject proposals, add plans, run imports and connect Xero.",
    implies: ["budget.view"],
  },
  "emails.view": {
    audience: "team",
    group: "Emails",
    level: "view",
    label: "View sent emails",
    description: "The announcements and other emails we've sent, as a catalog.",
  },
  "api_docs.view": {
    audience: "team",
    group: "API keys",
    level: "view",
    label: "API docs",
    description:
      "The admin API reference and agent guide at /backstage/api-docs.",
  },
  "api_keys.self": {
    audience: "team",
    group: "API keys",
    level: "edit",
    label: "Own API keys",
    description: "Mint and revoke your own API keys from /backstage/api-keys.",
    implies: ["api_docs.view"],
  },
  "schema.view": {
    audience: "team",
    group: "Database",
    level: "view",
    label: "Schema",
    description: "Read-only, under /backstage/schema.",
  },
  "submissions.grade": {
    audience: "team",
    group: "Grading",
    level: "edit",
    label: "Grade submissions",
    description: "The speaker committee's rubric at /grade.",
  },
  "megagame.verify": {
    audience: "team",
    group: "Megagame",
    level: "edit",
    label: "Verify quests",
    description:
      "Record quest completions and level-ups at /backstage/megagame.",
  },
  "megagame.manage": {
    audience: "team",
    group: "Megagame",
    level: "edit",
    label: "Manage megagame",
    description:
      "Add, edit and print quests at /backstage/quests, and undo other volunteers' confirmations and level-ups.",
    implies: ["megagame.verify"],
  },
  "misc.dice_lab": {
    audience: "team",
    group: "Misc",
    level: "view",
    label: "Dice lab",
    description:
      "Arrange the hero dice and export them as PNG/SVG assets, at /backstage/dice-lab.",
  },
  "misc.qr": {
    audience: "team",
    group: "Misc",
    level: "view",
    label: "QR codes",
    description:
      "Turn any link or text into a QR code in the poster styles, at /backstage/qr.",
  },
  "misc.signs": {
    audience: "team",
    group: "Misc",
    level: "edit",
    label: "Sign maker",
    description:
      "Make print-ready event signs and share drafts with the team, at /backstage/signs.",
  },
  "roles.manage": {
    audience: "team",
    group: "Sensitive",
    level: "edit",
    label: "Manage roles",
    description: "Make roles and change which permissions each carries.",
  },
  "api_keys.manage": {
    audience: "team",
    group: "Sensitive",
    level: "edit",
    label: "All API keys",
    description:
      "Mint and revoke anyone's API keys; keys for admins stay admin-only.",
    implies: ["api_docs.view"],
  },
  "users.delete": {
    audience: "team",
    group: "Sensitive",
    level: "delete",
    label: "Delete users",
    description:
      "Permanently delete non-admin accounts. Admin, bans and deleting an admin stay admin-only.",
    implies: ["users.view"],
  },
} as const satisfies Record<
  string,
  {
    audience: PermissionAudience;
    group: string;
    level: PermissionLevel;
    label: string;
    description: string;
    implies?: readonly string[];
  }
>;

export type Permission = keyof typeof PERMISSIONS;

export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[];

/** A caption under an area heading on the roles grid. */
export const GROUP_NOTES: Record<string, string> = {
  Sensitive: "Normally admin-only; grant in a pinch.",
};

/** The catalog in display order, one entry per area. */
export function permissionGroups(): { group: string; keys: Permission[] }[] {
  const out: { group: string; keys: Permission[] }[] = [];
  for (const key of PERMISSION_KEYS) {
    const { group } = PERMISSIONS[key];
    const last = out.at(-1);
    if (last?.group === group) last.keys.push(key);
    else out.push({ group, keys: [key] });
  }
  return out;
}

export const isPermission = (value: unknown): value is Permission =>
  typeof value === "string" && Object.hasOwn(PERMISSIONS, value);

/** Whether holding any of these counts as team access (see PermissionAudience). */
export const hasTeamPermission = (held: Iterable<Permission>): boolean => {
  for (const p of held) if (PERMISSIONS[p].audience === "team") return true;
  return false;
};

export type AccessInput = {
  /** Better Auth `user.role = 'admin'`: holds everything. */
  admin: boolean;
  roles: readonly {
    name: string;
    permissions: readonly string[];
    /** Set on a built-in role that attaches itself, e.g. "has a ticket". */
    auto?: string;
  }[];
  /** Per-user grants on top of the roles. */
  grants: readonly string[];
};

/** Why an account holds a permission, in precedence order. */
export type Source =
  | { kind: "admin" }
  | { kind: "grant" }
  | { kind: "role"; role: string; auto?: string }
  | { kind: "implied"; by: Permission };

export type Explanation = {
  effective: boolean;
  /** The first source is the deciding one; the rest would also apply. */
  sources: Source[];
};

/** Closes a set over `implies`. Unknown keys (a removed permission) drop out. */
export function expand(permissions: Iterable<string>): Set<Permission> {
  const out = new Set<Permission>();
  const visit = (p: string) => {
    if (!isPermission(p) || out.has(p)) return;
    out.add(p);
    for (const q of implied(p)) visit(q);
  };
  for (const p of permissions) visit(p);
  return out;
}

const implied = (p: Permission): readonly Permission[] =>
  ((PERMISSIONS[p] as { implies?: readonly Permission[] }).implies ??
    []) as readonly Permission[];

/** Effective = expand(role permissions ∪ grants). */
export function effectivePermissions(input: AccessInput): Set<Permission> {
  if (input.admin) return new Set(PERMISSION_KEYS);
  return expand([
    ...input.roles.flatMap((r) => r.permissions),
    ...input.grants,
  ]);
}

/** `effectivePermissions` plus where each one comes from, for the admin UI. */
export function explainPermissions(
  input: AccessInput,
): Record<Permission, Explanation> {
  const effective = effectivePermissions(input);
  const out = {} as Record<Permission, Explanation>;
  for (const p of PERMISSION_KEYS) {
    const sources: Source[] = [];
    if (input.admin) sources.push({ kind: "admin" });
    if (input.grants.includes(p)) sources.push({ kind: "grant" });
    for (const r of input.roles) {
      if (r.permissions.includes(p))
        sources.push(
          r.auto
            ? { kind: "role", role: r.name, auto: r.auto }
            : { kind: "role", role: r.name },
        );
    }
    // Admins hold everything outright, so implications are only noise.
    if (!input.admin) {
      for (const q of PERMISSION_KEYS) {
        if (q !== p && expand([q]).has(p) && effective.has(q)) {
          sources.push({ kind: "implied", by: q });
        }
      }
    }
    out[p] = { effective: effective.has(p), sources };
  }
  return out;
}

export function describeSource(source: Source): string {
  switch (source.kind) {
    case "admin":
      return "Admin";
    case "grant":
      return "Granted";
    case "role":
      return source.auto
        ? `Role: ${source.role} (${source.auto})`
        : `Role: ${source.role}`;
    case "implied":
      return `Implied by ${PERMISSIONS[source.by].group}: ${PERMISSIONS[source.by].label}`;
  }
}
