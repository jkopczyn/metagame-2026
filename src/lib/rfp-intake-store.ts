import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { profiles, sessionHosts, sessions } from "@/db/schema";
import { env } from "@/env";
import { airtableConfig } from "./airtable-config";
import {
  fillOnly,
  HOST_ALIASES,
  mapRfpRecord,
  type RfpHost,
  type RfpSessionValues,
} from "./rfp-intake";
import { slugify } from "./schedule";
import {
  ensureAccount,
  findAccount,
  invalidateSchedule,
  sessionIdBySlug,
} from "./schedule-store";

export type IntakeResult = {
  sessionId: string;
  slug: string;
  created: boolean;
  /** Columns filled on a session that already existed. */
  filled: string[];
  hostUserId: string | null;
  warnings: string[];
};

export const RECORD_ID = /^rec[A-Za-z0-9]{14}$/;

/** The record's fields, or null when Airtable has no such record. */
export async function fetchRfpRecord(
  recordId: string,
): Promise<Record<string, unknown> | null> {
  const key = env.AIRTABLE_API_KEY;
  if (!key) throw new Error("AIRTABLE_API_KEY is not set.");
  const res = await fetch(
    `https://api.airtable.com/v0/${airtableConfig.baseId}/${airtableConfig.rfpSubmissionsTableId}/${recordId}`,
    { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Airtable responded ${res.status}: ${await res.text()}`);
  }
  return ((await res.json()) as { fields: Record<string, unknown> }).fields;
}

/**
 * Makes the session for an RFP record, or fills the empty columns of the one
 * already made from it. Never overwrites: once a session exists the database,
 * not Airtable, is its source of truth.
 */
export async function intakeRfp(
  recordId: string,
  fields: Record<string, unknown>,
): Promise<IntakeResult> {
  const { values, host, warnings } = mapRfpRecord(fields);
  const hostUserId = await hostAccount(host, warnings);
  if (hostUserId) await fillProfile(hostUserId, host);

  const made = await createSession(recordId, values, hostUserId);
  if (made) {
    return { ...made, created: true, filled: [], hostUserId, warnings };
  }
  const existing = await fillSession(recordId, values, hostUserId);
  return { ...existing, created: false, hostUserId, warnings };
}

async function hostAccount(
  host: RfpHost,
  warnings: string[],
): Promise<string | null> {
  if (!host.email) {
    warnings.push("No host email; no host linked.");
    return null;
  }
  let email = host.email;
  const alias = HOST_ALIASES[email];
  if (alias) {
    let found: string | undefined;
    for (const candidate of alias.to) {
      if (await findAccount(candidate)) {
        found = candidate;
        break;
      }
    }
    if (!found && alias.mustExist) {
      warnings.push(`No account for ${alias.to[0]}; no host linked.`);
      return null;
    }
    email = found ?? alias.to[0];
  }
  return (await ensureAccount(host.name, email)).userId;
}

async function fillProfile(userId: string, host: RfpHost) {
  const db = getDb();
  if (host.discord) {
    await db
      .update(profiles)
      .set({ discordHandle: host.discord })
      .where(and(eq(profiles.userId, userId), isNull(profiles.discordHandle)));
  }
  if (host.website) {
    await db
      .update(profiles)
      .set({ website: host.website })
      .where(and(eq(profiles.userId, userId), isNull(profiles.website)));
  }
}

async function uniqueSlug(title: string, recordId: string) {
  const base = slugify(title) || "proposal";
  return (await sessionIdBySlug(base))
    ? `${base}-${recordId.slice(-5).toLowerCase()}`
    : base;
}

/** The new draft and its lead host in one statement; null if one exists. */
async function createSession(
  recordId: string,
  v: RfpSessionValues,
  hostUserId: string | null,
): Promise<{ sessionId: string; slug: string } | null> {
  const slug = await uniqueSlug(v.title, recordId);
  const { rows } = await getDb().execute<{ id: string; slug: string }>(sql`
    with s as (
      insert into sessions (
        slug, title, status, airtable_rfp_record_id,
        description, category, ages, min_capacity, max_capacity, needs,
        phase, verdict, speaker_tier, context, requested_duration, cohosts,
        timing_constraints, other_constraints, age_elaboration,
        application_required, bespoke_needs, anything_else,
        megagame_interest, marketing_consent, discord_status, megagame_notes,
        ticket_state, housing_status, communication_notes, ricki_notes)
      values (
        ${slug}, ${v.title}, 'draft', ${recordId},
        ${v.description}, ${v.category}, ${v.ages},
        ${v.minCapacity}, ${v.maxCapacity}, ${v.needs},
        ${v.phase}, ${v.verdict}, ${v.speakerTier}, ${v.context},
        ${v.requestedDuration}, ${v.cohosts},
        ${v.timingConstraints}, ${v.otherConstraints},
        ${v.ageElaboration}, ${v.applicationRequired},
        ${v.bespokeNeeds}, ${v.anythingElse}, ${v.megagameInterest},
        ${v.marketingConsent}, ${v.discordStatus}, ${v.megagameNotes},
        ${v.ticketState}, ${v.housingStatus},
        ${v.communicationNotes}, ${v.rickiNotes})
      on conflict (airtable_rfp_record_id) do nothing
      returning id, slug
    ), h as (
      insert into session_hosts (session_id, position, user_id)
      select s.id, 0, ${hostUserId}::text from s where ${hostUserId}::text is not null
    )
    select id, slug from s`);
  const [row] = rows;
  if (!row) return null;
  invalidateSchedule();
  return { sessionId: row.id, slug: row.slug };
}

type Existing = RfpSessionValues & { id: string; slug: string };

async function fillSession(
  recordId: string,
  values: RfpSessionValues,
  hostUserId: string | null,
): Promise<{ sessionId: string; slug: string; filled: string[] }> {
  const db = getDb();
  const select = Object.fromEntries(
    Object.keys(values).map((k) => [k, sessions[k as keyof RfpSessionValues]]),
  ) as { [K in keyof RfpSessionValues]: (typeof sessions)[K] };
  const [existing] = (await db
    .select({ id: sessions.id, slug: sessions.slug, ...select })
    .from(sessions)
    .where(eq(sessions.airtableRfpRecordId, recordId))
    .limit(1)) as Existing[];
  if (!existing) throw new Error(`No session for ${recordId} after insert.`);

  const patch = fillOnly(existing, values);
  const filled = Object.keys(patch);
  if (filled.length) {
    await db.update(sessions).set(patch).where(eq(sessions.id, existing.id));
  }
  if (hostUserId) {
    const [hosted] = await db
      .select({ userId: sessionHosts.userId })
      .from(sessionHosts)
      .where(eq(sessionHosts.sessionId, existing.id))
      .limit(1);
    if (!hosted) {
      await db
        .insert(sessionHosts)
        .values({ sessionId: existing.id, position: 0, userId: hostUserId })
        .onConflictDoNothing();
      filled.push("host");
    }
  }
  if (filled.length) invalidateSchedule();
  return { sessionId: existing.id, slug: existing.slug, filled };
}
