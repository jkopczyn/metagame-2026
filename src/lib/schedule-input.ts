// Validation shared by the /backstage/schedule form actions and the JSON API, so
// the two can't drift. Input is a loose record (FormData entries or a JSON
// body); output is what the store takes. No database imports.

import {
  AGES,
  CATEGORIES,
  LOCATION_VISIBILITIES,
  STATUSES,
  fromPacificWall,
  outsideHours,
  slugify,
  type Ages,
  type Category,
  type ScheduleLocation,
  type Status,
} from "./schedule";

import type { Raw } from "./admin-api";
export type { Raw };

export type Invalid = { field: string; error: string };
export type Parsed<T> = { ok: true; value: T } | ({ ok: false } & Invalid);

/** A session as the store takes it, minus hosts (resolved by the caller). */
export type SessionFields = {
  slug: string;
  title: string;
  description: string | null;
  category: Category | null;
  startsAt: Date | null;
  endsAt: Date | null;
  locationId: string | null;
  maxCapacity: number | null;
  minCapacity: number | null;
  ages: Ages | null;
  needs: string | null;
  status: Status;
  rsvpIsCommitment: boolean;
  sponsored: boolean;
  /** Undefined when the input doesn't mention it, so it's left as stored. */
  airtableRfpRecordId?: string | null;
  /** Undefined when the input doesn't mention it, so it's left as stored. */
  shepherdUserId?: string | null;
};

export type LocationFields = Omit<
  ScheduleLocation,
  "id" | "thumbnailUrl" | "imageUrl"
>;

/**
 * What a session's own host may change. Placement, status and slug are the
 * team's: a host must not be able to move themselves into a better room, put
 * an unpublished session on the public schedule, or break existing links by
 * renaming. Kept apart from SessionFields so the wider parser can't be
 * reached from the host form by accident.
 */
export type HostSessionFields = {
  title: string;
  description: string | null;
  category: Category | null;
  maxCapacity: number | null;
  minCapacity: number | null;
  ages: Ages | null;
  needs: string | null;
  rsvpIsCommitment: boolean;
};

const str = (raw: Raw, key: string) => {
  const v = raw[key];
  return v === null || v === undefined ? "" : String(v).trim();
};

const optional = (raw: Raw, key: string) => str(raw, key) || null;

function oneOf<T extends string>(
  value: string,
  choices: readonly T[],
): T | null {
  return (choices as readonly string[]).includes(value) ? (value as T) : null;
}

/** A whole number, null when blank, NaN when not one. JSON may send a number. */
function int(raw: Raw, key: string): number | null {
  const v = raw[key];
  if (typeof v === "number") return Number.isInteger(v) ? v : Number.NaN;
  const s = str(raw, key);
  if (!s) return null;
  return /^-?\d+$/.test(s) ? Number(s) : Number.NaN;
}

/**
 * A checkbox: FormData sends "on" when ticked and nothing when not, JSON a
 * boolean. Absent is false; anything else is null.
 */
function flag(raw: Raw, key: string): boolean | null {
  const v = raw[key];
  if (v === undefined || v === null || v === false || v === "") return false;
  if (v === true || v === "on" || v === "true") return true;
  return v === "false" ? false : null;
}

/** `startsAt`/`endsAt` are Pacific wall-clock strings, "2026-11-06T14:00". */
/** The host-editable subset. Anything else in `raw` is ignored, not rejected. */
export function parseHostSessionFields(raw: Raw): Parsed<HostSessionFields> {
  const title = str(raw, "title");
  if (!title) return { ok: false, field: "title", error: "Required." };

  const maxCapacity = int(raw, "maxCapacity");
  const minCapacity = int(raw, "minCapacity");
  if (Number.isNaN(maxCapacity))
    return { ok: false, field: "maxCapacity", error: "Whole number." };
  if (Number.isNaN(minCapacity))
    return { ok: false, field: "minCapacity", error: "Whole number." };
  if (maxCapacity !== null && maxCapacity < 1)
    return { ok: false, field: "maxCapacity", error: "At least one seat." };
  if (minCapacity !== null && maxCapacity !== null && minCapacity > maxCapacity)
    return {
      ok: false,
      field: "minCapacity",
      error: "Minimum can't exceed the maximum.",
    };

  const categoryRaw = str(raw, "category");
  const category = oneOf(categoryRaw, CATEGORIES);
  if (categoryRaw && !category)
    return {
      ok: false,
      field: "category",
      error: `One of ${CATEGORIES.join(", ")}.`,
    };

  const agesRaw = str(raw, "ages");
  const ages = oneOf(agesRaw, AGES);
  if (agesRaw && !ages)
    return { ok: false, field: "ages", error: `One of ${AGES.join(", ")}.` };

  const rsvpIsCommitment = flag(raw, "rsvpIsCommitment");
  if (rsvpIsCommitment === null)
    return { ok: false, field: "rsvpIsCommitment", error: "true or false." };

  return {
    ok: true,
    value: {
      title,
      description: optional(raw, "description"),
      category,
      maxCapacity,
      minCapacity,
      ages,
      needs: optional(raw, "needs"),
      rsvpIsCommitment,
    },
  };
}

export function parseSessionFields(raw: Raw): Parsed<SessionFields> {
  const title = str(raw, "title");
  if (!title) return { ok: false, field: "title", error: "Required." };
  const slug = slugify(str(raw, "slug") || title);
  if (!slug)
    return { ok: false, field: "slug", error: "Needs a letter or digit." };

  const startRaw = str(raw, "startsAt");
  const endRaw = str(raw, "endsAt");
  const startsAt = startRaw ? fromPacificWall(startRaw) : null;
  const endsAt = endRaw ? fromPacificWall(endRaw) : null;
  if (startRaw && !startsAt)
    return { ok: false, field: "startsAt", error: "Not a time." };
  if (endRaw && !endsAt)
    return { ok: false, field: "endsAt", error: "Not a time." };
  if (Boolean(startsAt) !== Boolean(endsAt)) {
    return {
      ok: false,
      field: startsAt ? "endsAt" : "startsAt",
      error: "Set both times, or neither for an unplaced draft.",
    };
  }
  if (startsAt && endsAt && endsAt <= startsAt) {
    return { ok: false, field: "endsAt", error: "End must be after start." };
  }

  const outside = startsAt && endsAt ? outsideHours(startsAt, endsAt) : null;
  if (outside) return { ok: false, ...outside };

  const maxCapacity = int(raw, "maxCapacity");
  const minCapacity = int(raw, "minCapacity");
  if (Number.isNaN(maxCapacity))
    return { ok: false, field: "maxCapacity", error: "Whole number." };
  if (Number.isNaN(minCapacity))
    return { ok: false, field: "minCapacity", error: "Whole number." };

  const statusRaw = str(raw, "status");
  const status = oneOf(statusRaw, STATUSES);
  if (statusRaw && !status) {
    return {
      ok: false,
      field: "status",
      error: `One of ${STATUSES.join(", ")}.`,
    };
  }
  if (status === "published" && !startsAt) {
    return {
      ok: false,
      field: "status",
      error: "A published session needs a start and end time.",
    };
  }

  const categoryRaw = str(raw, "category");
  const category = oneOf(categoryRaw, CATEGORIES);
  if (categoryRaw && !category) {
    return {
      ok: false,
      field: "category",
      error: `One of ${CATEGORIES.join(", ")}.`,
    };
  }
  const agesRaw = str(raw, "ages");
  const ages = oneOf(agesRaw, AGES);
  if (agesRaw && !ages) {
    return {
      ok: false,
      field: "ages",
      error: `One of ${AGES.join(", ")}.`,
    };
  }

  const rsvpIsCommitment = flag(raw, "rsvpIsCommitment");
  if (rsvpIsCommitment === null)
    return { ok: false, field: "rsvpIsCommitment", error: "true or false." };
  const sponsored = flag(raw, "sponsored");
  if (sponsored === null)
    return { ok: false, field: "sponsored", error: "true or false." };

  let airtableRfpRecordId: string | null | undefined;
  if ("airtableRfpRecordId" in raw) {
    airtableRfpRecordId = optional(raw, "airtableRfpRecordId");
    if (
      airtableRfpRecordId &&
      !/^rec[A-Za-z0-9]{14}$/.test(airtableRfpRecordId)
    ) {
      return {
        ok: false,
        field: "airtableRfpRecordId",
        error: "An Airtable record id, rec followed by 14 letters or digits.",
      };
    }
  }

  let shepherdUserId: string | null | undefined;
  if ("shepherdUserId" in raw) {
    const v = raw.shepherdUserId;
    if (v !== null && v !== undefined && typeof v !== "string") {
      return {
        ok: false,
        field: "shepherd",
        error: "shepherdUserId must be a user id or null.",
      };
    }
    shepherdUserId = optional(raw, "shepherdUserId");
  }

  return {
    ok: true,
    value: {
      slug,
      title,
      description: optional(raw, "description"),
      category,
      startsAt,
      endsAt,
      locationId: optional(raw, "locationId"),
      maxCapacity,
      minCapacity,
      ages,
      needs: optional(raw, "needs"),
      status: status ?? "draft",
      rsvpIsCommitment,
      sponsored,
      airtableRfpRecordId,
      shepherdUserId,
    },
  };
}

export function parseLocationFields(raw: Raw): Parsed<LocationFields> {
  const name = str(raw, "name");
  if (!name) return { ok: false, field: "name", error: "Required." };
  const capacity = int(raw, "capacity");
  if (Number.isNaN(capacity))
    return { ok: false, field: "capacity", error: "Whole number." };
  const displayOrder = int(raw, "displayOrder") ?? 100;
  if (Number.isNaN(displayOrder))
    return { ok: false, field: "displayOrder", error: "Whole number." };
  const visibilityRaw = str(raw, "visibility");
  const visibility = oneOf(visibilityRaw, LOCATION_VISIBILITIES);
  if (visibilityRaw && !visibility) {
    return {
      ok: false,
      field: "visibility",
      error: `One of ${LOCATION_VISIBILITIES.join(", ")}.`,
    };
  }
  return {
    ok: true,
    value: {
      name,
      capacity,
      campusLocation: optional(raw, "campusLocation"),
      description: optional(raw, "description"),
      displayOrder,
      visibility: visibility ?? "hidden",
    },
  };
}
