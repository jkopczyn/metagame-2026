import {
  and,
  asc,
  eq,
  ne,
  exists,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { GradeInput, GradeValues, SessionText } from "./grade-input";
import { COMMITTEE_EMAILS, committeeName } from "./rfp-committee";
import { nextStepsFor, SPACE_OPTION_LOCATIONS } from "./rfp-labels";
import {
  gradeFields,
  graderWrite,
  mirror,
  nextStepsField,
  sessionFields,
  shepherdWrite,
  verdictField,
  type MirrorGroup,
} from "./rfp-mirror";
import {
  accountName,
  assertSlotFree,
  invalidateSchedule,
  searchAccounts as searchAccountRows,
} from "./schedule-store";

// The RFP pipeline in Postgres: sessions that came through the RFP or were
// given a phase, their grades, and the committee's edits. Every write is copied onto
// the Airtable RFP row afterwards (see rfp-mirror.ts).

const {
  sessions,
  sessionHosts,
  sessionGrades,
  sessionGradeSpaceOptions,
  locations,
  user,
  profiles,
} = schema;

export const PHASES = schema.sessionPhase.enumValues;
export type Phase = (typeof PHASES)[number];
export const VERDICTS = schema.sessionVerdict.enumValues;
export type Verdict = (typeof VERDICTS)[number];

export const SPEAKER_TIERS = schema.speakerTier.enumValues;
export type SpeakerTier = (typeof SPEAKER_TIERS)[number];
export const MEGAGAME_INTEGRATION_LEVELS =
  schema.megagameIntegrationLevel.enumValues;
export type MegagameIntegrationLevel =
  (typeof MEGAGAME_INTEGRATION_LEVELS)[number];

export const isPhase = (v: string): v is Phase =>
  (PHASES as readonly string[]).includes(v);
export const isVerdict = (v: string): v is Verdict =>
  (VERDICTS as readonly string[]).includes(v);

export type Account = {
  userId: string;
  /** Preferred name, else account name, else email. */
  name: string;
  email: string;
  /** How Airtable's Grader and Shepherd selects name them, if they're on the committee. */
  committeeName: string | null;
};

export type Grade = GradeValues & {
  grader: Account;
  /** The rooms the grader suggests. */
  spaceOptions: { locationId: string; name: string }[];
  /** Null while the grade is only an assignment. */
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type HostAccount = Account & {
  discordHandle: string | null;
  website: string | null;
  imageUrl: string | null;
};

export type RfpSession = {
  sessionId: string;
  /** The Airtable RFP Submissions row, for imported sessions. */
  recordId: string | null;
  slug: string;
  title: string;
  /** Lead host first. */
  hosts: HostAccount[];
  phase: Phase | null;
  /** The Airtable "Next steps" option the phase stands for. */
  nextSteps: string | null;
  verdict: Verdict | null;
  shepherd: Account | null;
  /** Oldest first. */
  grades: Grade[];
  /** attributedGrader's grader: the one Airtable's single Grader shows. */
  grader: Account | null;
  /** The whole sessions row, for the RFP answers and committee notes. */
  row: typeof sessions.$inferSelect;
};

export type RfpSessionFilter = {
  /** Null matches sessions with no phase yet. */
  phases?: (Phase | null)[];
  /** Has a grade row (assigned or submitted) from this account. */
  graderUserId?: string;
  verdicts?: (Verdict | null)[];
  shepherdUserId?: string;
};

const accountColumns = {
  userId: user.id,
  name: accountName,
  email: user.email,
};

const withCommittee = <A extends Omit<Account, "committeeName">>(a: A) => ({
  ...a,
  committeeName: committeeName(a.email),
});

/** Sessions in the RFP pipeline: imported from an RFP, or given a phase. */
const inPipeline = or(
  isNotNull(sessions.airtableRfpRecordId),
  isNotNull(sessions.phase),
);

function filterWhere(filter: RfpSessionFilter): SQL | undefined {
  const conditions: (SQL | undefined)[] = [inPipeline];
  if (filter.phases) {
    const named = filter.phases.filter((p): p is Phase => p !== null);
    conditions.push(
      or(
        named.length > 0 ? inArray(sessions.phase, named) : sql`false`,
        filter.phases.includes(null) ? isNull(sessions.phase) : undefined,
      ),
    );
  }
  if (filter.verdicts) {
    const named = filter.verdicts.filter((v): v is Verdict => v !== null);
    conditions.push(
      or(
        named.length > 0 ? inArray(sessions.verdict, named) : sql`false`,
        filter.verdicts.includes(null) ? isNull(sessions.verdict) : undefined,
      ),
    );
  }
  if (filter.graderUserId) {
    conditions.push(
      exists(
        getDb()
          .select({ one: sql`1` })
          .from(sessionGrades)
          .where(
            and(
              eq(sessionGrades.sessionId, sessions.id),
              eq(sessionGrades.graderUserId, filter.graderUserId),
            ),
          ),
      ),
    );
  }
  if (filter.shepherdUserId) {
    conditions.push(eq(sessions.shepherdUserId, filter.shepherdUserId));
  }
  return and(...conditions);
}

async function hostsBySession(ids: string[]) {
  const out = new Map<string, HostAccount[]>();
  if (ids.length === 0) return out;
  const rows = await getDb()
    .select({
      sessionId: sessionHosts.sessionId,
      ...accountColumns,
      discordHandle: profiles.discordHandle,
      website: profiles.website,
      imageUrl: profiles.imageUrl,
    })
    .from(sessionHosts)
    .innerJoin(user, eq(user.id, sessionHosts.userId))
    .leftJoin(profiles, eq(profiles.userId, user.id))
    .where(inArray(sessionHosts.sessionId, ids))
    .orderBy(asc(sessionHosts.sessionId), asc(sessionHosts.position));
  for (const { sessionId, ...host } of rows) {
    out.set(sessionId, [...(out.get(sessionId) ?? []), withCommittee(host)]);
  }
  return out;
}

async function gradesBySession(ids: string[]) {
  const out = new Map<string, Grade[]>();
  if (ids.length === 0) return out;
  const db = getDb();
  const rows = await db
    .select({
      id: sessionGrades.id,
      sessionId: sessionGrades.sessionId,
      grader: accountColumns,
      operationalEase: sessionGrades.operationalEase,
      hostCompetence: sessionGrades.hostCompetence,
      hostNameRecognition: sessionGrades.hostNameRecognition,
      subjectMatter: sessionGrades.subjectMatter,
      fun: sessionGrades.fun,
      verdictRecommendation: sessionGrades.verdictRecommendation,
      qualityNotes: sessionGrades.qualityNotes,
      schedulerNotes: sessionGrades.schedulerNotes,
      shepherdMatch: sessionGrades.shepherdMatch,
      topicAreas: sessionGrades.topicAreas,
      potentialPanels: sessionGrades.potentialPanels,
      megagameIntegration: sessionGrades.megagameIntegration,
      expectedCrowdSize: sessionGrades.expectedCrowdSize,
      allowDropins: sessionGrades.allowDropins,
      submittedAt: sessionGrades.submittedAt,
      createdAt: sessionGrades.createdAt,
      updatedAt: sessionGrades.updatedAt,
    })
    .from(sessionGrades)
    .innerJoin(user, eq(user.id, sessionGrades.graderUserId))
    .leftJoin(profiles, eq(profiles.userId, user.id))
    .where(inArray(sessionGrades.sessionId, ids))
    .orderBy(asc(sessionGrades.createdAt), asc(sessionGrades.id));
  const spaces =
    rows.length === 0
      ? []
      : await db
          .select({
            gradeId: sessionGradeSpaceOptions.gradeId,
            locationId: locations.id,
            name: locations.name,
          })
          .from(sessionGradeSpaceOptions)
          .innerJoin(
            locations,
            eq(locations.id, sessionGradeSpaceOptions.locationId),
          )
          .where(
            inArray(
              sessionGradeSpaceOptions.gradeId,
              rows.map((r) => r.id),
            ),
          );
  for (const { id, sessionId, grader, ...grade } of rows) {
    out.set(sessionId, [
      ...(out.get(sessionId) ?? []),
      {
        ...grade,
        grader: withCommittee(grader),
        spaceOptions: spaces
          .filter((s) => s.gradeId === id)
          .map(({ locationId, name }) => ({ locationId, name })),
      },
    ]);
  }
  return out;
}

async function loadRfpSessions(where: SQL | undefined): Promise<RfpSession[]> {
  const rows = await getDb()
    .select({ session: sessions, shepherd: accountColumns })
    .from(sessions)
    .leftJoin(user, eq(user.id, sessions.shepherdUserId))
    .leftJoin(profiles, eq(profiles.userId, user.id))
    .where(where)
    .orderBy(asc(sessions.title));
  const ids = rows.map((r) => r.session.id);
  const [hosts, grades] = await Promise.all([
    hostsBySession(ids),
    gradesBySession(ids),
  ]);
  return rows.map(({ session, shepherd }) => {
    const sessionGradeRows = grades.get(session.id) ?? [];
    return {
      sessionId: session.id,
      recordId: session.airtableRfpRecordId,
      slug: session.slug,
      title: session.title,
      hosts: hosts.get(session.id) ?? [],
      phase: session.phase,
      nextSteps: nextStepsFor(session.phase, {
        graded: sessionGradeRows.length > 0,
        shepherded: session.shepherdUserId !== null,
      }),
      verdict: session.verdict,
      // A left join yields an all-null object when there's no shepherd.
      shepherd: shepherd?.userId ? withCommittee(shepherd) : null,
      grades: sessionGradeRows,
      grader: attributedGrader(sessionGradeRows)?.grader ?? null,
      row: session,
    };
  });
}

export type GradingSummary = {
  /** Imported from an RFP or given a phase: the grading page applies. */
  inPipeline: boolean;
  /** Each submitted grade's note to whoever schedules the session. */
  notes: { graderUserId: string; grader: string; text: string }[];
};

/** What the schedule's admin views show about a session's grading. */
export async function gradingSummary(
  sessionId: string,
): Promise<GradingSummary | null> {
  const db = getDb();
  const [[row], notes] = await Promise.all([
    db
      .select({ recordId: sessions.airtableRfpRecordId, phase: sessions.phase })
      .from(sessions)
      .where(eq(sessions.id, sessionId)),
    db
      .select({
        graderUserId: user.id,
        grader: accountName,
        text: sessionGrades.schedulerNotes,
      })
      .from(sessionGrades)
      .innerJoin(user, eq(user.id, sessionGrades.graderUserId))
      .where(
        and(
          eq(sessionGrades.sessionId, sessionId),
          isNotNull(sessionGrades.submittedAt),
          isNotNull(sessionGrades.schedulerNotes),
        ),
      )
      .orderBy(asc(sessionGrades.createdAt)),
  ]);
  if (!row) return null;
  return {
    inPipeline: row.recordId !== null || row.phase !== null,
    notes: notes.flatMap((n) => {
      const text = n.text?.trim();
      return text ? [{ ...n, text }] : [];
    }),
  };
}

/** Every RFP session matching the filter, by title. */
export function listRfpSessions(
  filter: RfpSessionFilter = {},
): Promise<RfpSession[]> {
  return loadRfpSessions(filterWhere(filter));
}

type GradeTimes = {
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * The grade a session is attributed to: the most recently saved submitted
 * one, else the latest assignment.
 */
export function attributedGrader<G extends GradeTimes>(grades: G[]): G | null {
  const submitted = grades.filter((g) => g.submittedAt !== null);
  const pool = submitted.length > 0 ? submitted : grades;
  const time = (g: G) =>
    (submitted.length > 0 ? g.updatedAt : g.createdAt).getTime();
  return pool.reduce<G | null>(
    (best, g) => (best === null || time(g) > time(best) ? g : best),
    null,
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isSessionId = (id: string) => UUID.test(id);

/** One session by id, whether or not it's in the pipeline. */
export async function getRfpSession(
  sessionId: string,
): Promise<RfpSession | null> {
  if (!isSessionId(sessionId)) return null;
  const [found] = await loadRfpSessions(eq(sessions.id, sessionId));
  return found ?? null;
}

export async function getRfpSessionBySlug(
  slug: string,
): Promise<RfpSession | null> {
  const [found] = await loadRfpSessions(eq(sessions.slug, slug));
  return found ?? null;
}

/** The session imported from an Airtable RFP row. */
export async function getRfpSessionByRecordId(
  recordId: string,
): Promise<RfpSession | null> {
  const [found] = await loadRfpSessions(
    eq(sessions.airtableRfpRecordId, recordId),
  );
  return found ?? null;
}

/** Committee members (COMMITTEE_EMAILS) who have accounts, by committee name. */
export async function committeeAccounts(): Promise<
  (Account & { committeeName: string })[]
> {
  const rows = await getDb()
    .select(accountColumns)
    .from(user)
    .leftJoin(profiles, eq(profiles.userId, user.id))
    .where(inArray(sql`lower(${user.email})`, Object.values(COMMITTEE_EMAILS)));
  return rows
    .map(withCommittee)
    .filter((a): a is typeof a & { committeeName: string } =>
      Boolean(a.committeeName),
    )
    .sort((a, b) => a.committeeName.localeCompare(b.committeeName));
}

/** Accounts whose name or email contains the query, a few at most. */
export async function searchAccounts(query: string): Promise<Account[]> {
  return (await searchAccountRows(query)).map(withCommittee);
}

/**
 * The account behind a committee name, matched by email the way the Airtable
 * import did. For the shared-password sign-in, which identifies by name.
 */
export async function committeeUserId(name: string): Promise<string | null> {
  if (!Object.hasOwn(COMMITTEE_EMAILS, name)) return null;
  const [row] = await getDb()
    .select({ id: user.id })
    .from(user)
    .where(eq(sql`lower(${user.email})`, COMMITTEE_EMAILS[name]))
    .limit(1);
  return row?.id ?? null;
}

/** The rooms a grader can suggest: the RFP form's space options, in its order. */
export async function spaceOptionLocations(): Promise<
  { id: string; name: string; label: string }[]
> {
  const labels = Object.entries(SPACE_OPTION_LOCATIONS);
  const names = labels.map(([, name]) => name);
  const rows = await getDb()
    .select({ id: locations.id, name: locations.name })
    .from(locations)
    .where(inArray(locations.name, names));
  return rows
    .map((r) => ({ ...r, label: labels.find(([, n]) => n === r.name)![0] }))
    .sort((a, b) => names.indexOf(a.name) - names.indexOf(b.name));
}

// ── Writes ───────────────────────────────────────────────────────────────────

type MirrorAccount = { email: string; name: string };

/** What the Airtable mirror needs to know about a session after a write. */
export type MirrorState = {
  recordId: string | null;
  phase: Phase | null;
  verdict: Verdict | null;
  graded: boolean;
  shepherd: MirrorAccount | null;
  /** attributedGrader's account: whose grade Airtable's single row shows. */
  grader: MirrorAccount | null;
};

async function mirrorState(sessionId: string): Promise<MirrorState | null> {
  const db = getDb();
  const [[row], grades] = await Promise.all([
    db
      .select({
        recordId: sessions.airtableRfpRecordId,
        phase: sessions.phase,
        verdict: sessions.verdict,
        shepherdEmail: user.email,
        shepherdName: accountName,
      })
      .from(sessions)
      .leftJoin(user, eq(user.id, sessions.shepherdUserId))
      .leftJoin(profiles, eq(profiles.userId, user.id))
      .where(eq(sessions.id, sessionId)),
    db
      .select({
        email: user.email,
        name: accountName,
        submittedAt: sessionGrades.submittedAt,
        createdAt: sessionGrades.createdAt,
        updatedAt: sessionGrades.updatedAt,
      })
      .from(sessionGrades)
      .innerJoin(user, eq(user.id, sessionGrades.graderUserId))
      .leftJoin(profiles, eq(profiles.userId, user.id))
      .where(eq(sessionGrades.sessionId, sessionId)),
  ]);
  if (!row) return null;
  const grader = attributedGrader(grades);
  return {
    recordId: row.recordId,
    phase: row.phase,
    verdict: row.verdict,
    graded: grades.length > 0,
    shepherd: row.shepherdEmail
      ? { email: row.shepherdEmail, name: row.shepherdName }
      : null,
    grader: grader && { email: grader.email, name: grader.name },
  };
}

export type MirrorTrigger =
  | { kind: "grade"; advance: boolean; phase: Phase | null }
  | { kind: "assignment"; phase: Phase | null }
  | { kind: "update"; update: RfpSessionUpdate; phase: Phase | null };

/**
 * Whether a write can move "Next steps", so the mirror leaves it alone
 * otherwise. `phase` is the session's phase after the write.
 */
export function nextStepsMayChange(t: MirrorTrigger): boolean {
  switch (t.kind) {
    case "grade":
      // A save in grading can make the first grade row: "0." becomes "1.".
      return t.advance || t.phase === "grading";
    case "assignment":
      return t.phase === "grading";
    case "update":
      return (
        "phase" in t.update ||
        ("shepherdUserId" in t.update && t.phase === "shepherding")
      );
  }
}

/** Copy a write onto the RFP row. Never throws: the database write stands. */
async function mirrorSession(
  sessionId: string,
  trigger: MirrorTrigger | null,
  groups: (state: MirrorState) => MirrorGroup[],
): Promise<void> {
  try {
    const state = await mirrorState(sessionId);
    if (!state?.recordId) return;
    const steps =
      trigger && nextStepsMayChange(withPhase(trigger, state.phase))
        ? nextStepsField(state)
        : null;
    mirror(state.recordId, ...groups(state), steps);
  } catch (err) {
    console.error(`[rfp-mirror] couldn't read session ${sessionId}:`, err);
  }
}

const withPhase = (t: MirrorTrigger, phase: Phase | null): MirrorTrigger => ({
  ...t,
  phase,
});

export type RfpSessionUpdate = {
  phase?: Phase | null;
  verdict?: Verdict | null;
  shepherdUserId?: string | null;
  speakerTier?: SpeakerTier | null;
  /** Not mirrored: Airtable has no column for it. */
  megagameIntegrationLevel?: MegagameIntegrationLevel | null;
  marketingConsent?: boolean | null;
  text?: SessionText;
};

/** Change the pipeline columns given; anything left out is kept. */
export async function updateRfpSession(
  sessionId: string,
  update: RfpSessionUpdate,
): Promise<void> {
  const { text = {}, ...pipeline } = update;
  const set = { ...pipeline, ...text };
  if (Object.keys(set).length === 0) return;
  const [row] = await getDb()
    .update(sessions)
    .set(set)
    .where(eq(sessions.id, sessionId))
    .returning({ id: sessions.id });
  if (!row) throw new Error("That session no longer exists.");
  invalidateSchedule();

  await mirrorSession(
    sessionId,
    { kind: "update", update, phase: null },
    (s) => [
      {
        ...("verdict" in update ? verdictField(s) : {}),
        ...sessionFields(text, update.speakerTier, update.marketingConsent),
      },
      "shepherdUserId" in update ? shepherdWrite(s.shepherd) : null,
    ],
  );
}

/** Assign a grader: an unsubmitted grade row. A no-op if they have one. */
export async function assignGrader(
  sessionId: string,
  userId: string,
): Promise<void> {
  await getDb()
    .insert(sessionGrades)
    .values({ sessionId, graderUserId: userId })
    .onConflictDoNothing();
  await mirrorSession(sessionId, { kind: "assignment", phase: null }, (s) => [
    graderWrite(s.grader),
  ]);
}

/**
 * Take back an assignment. Only an unsubmitted one: a submitted grade is
 * never thrown away from here.
 */
export async function unassignGrader(
  sessionId: string,
  userId: string,
): Promise<"removed" | "submitted" | "missing"> {
  const db = getDb();
  const mine = and(
    eq(sessionGrades.sessionId, sessionId),
    eq(sessionGrades.graderUserId, userId),
  );
  const removed = await db
    .delete(sessionGrades)
    .where(and(mine, isNull(sessionGrades.submittedAt)))
    .returning({ id: sessionGrades.id });
  if (removed.length === 0) {
    const [kept] = await db
      .select({ id: sessionGrades.id })
      .from(sessionGrades)
      .where(mine);
    return kept ? "submitted" : "missing";
  }
  await mirrorSession(sessionId, { kind: "assignment", phase: null }, (s) => [
    graderWrite(s.grader),
  ]);
  return "removed";
}

/**
 * Save the grader's own grade, replacing every field of their row (inserting
 * it if they had none, which also counts as submitting it), its space
 * options, and the session notes in `input.session`. Notes are written only
 * when present, and they're shared by everyone grading the session, so callers
 * should send only the notes the grader actually changed. One transaction.
 */
export async function saveGrade(
  sessionId: string,
  graderUserId: string,
  input: GradeInput,
): Promise<void> {
  const db = getDb();
  const mine = and(
    eq(sessionGrades.sessionId, sessionId),
    eq(sessionGrades.graderUserId, graderUserId),
  );
  const myGradeId = db
    .select({ id: sessionGrades.id })
    .from(sessionGrades)
    .where(mine);
  const [found] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  if (!found) throw new Error("That session no longer exists.");

  await db.batch([
    db
      .insert(sessionGrades)
      .values({
        sessionId,
        graderUserId,
        ...input.grade,
        submittedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [sessionGrades.sessionId, sessionGrades.graderUserId],
        set: {
          ...input.grade,
          submittedAt: sql`coalesce(${sessionGrades.submittedAt}, now())`,
          updatedAt: new Date(),
        },
      }),
    db
      .delete(sessionGradeSpaceOptions)
      .where(inArray(sessionGradeSpaceOptions.gradeId, myGradeId)),
    ...(input.spaceLocationIds.length > 0
      ? [
          db
            .insert(sessionGradeSpaceOptions)
            .select(
              db
                .select({ gradeId: sessionGrades.id, locationId: locations.id })
                .from(sessionGrades)
                .innerJoin(
                  locations,
                  inArray(locations.id, input.spaceLocationIds),
                )
                .where(mine),
            ),
        ]
      : []),
    ...(Object.keys(input.session).length > 0
      ? [
          db
            .update(sessions)
            .set(input.session)
            .where(eq(sessions.id, sessionId)),
        ]
      : []),
    // Only out of grading: a later phase never walks back to the committee.
    ...(input.advance
      ? [
          db
            .update(sessions)
            .set({ phase: "deciding" })
            .where(
              and(
                eq(sessions.id, sessionId),
                or(isNull(sessions.phase), eq(sessions.phase, "grading")),
              ),
            ),
        ]
      : []),
  ]);

  const spaceNames = (await spaceOptionLocations())
    .filter((l) => input.spaceLocationIds.includes(l.id))
    .map((l) => l.name);
  // Airtable holds one grade per row, so the latest save wins there.
  await mirrorSession(
    sessionId,
    { kind: "grade", advance: input.advance, phase: null },
    (s) => [
      {
        ...gradeFields(input.grade, spaceNames),
        ...sessionFields(input.session),
      },
      graderWrite(s.grader),
    ],
  );
}

/** The committee accounts with a submitted grade on the session. */
async function submittedGraders(sessionId: string): Promise<Account[]> {
  const rows = await getDb()
    .select(accountColumns)
    .from(sessionGrades)
    .innerJoin(user, eq(user.id, sessionGrades.graderUserId))
    .where(
      and(
        eq(sessionGrades.sessionId, sessionId),
        isNotNull(sessionGrades.submittedAt),
      ),
    )
    .orderBy(asc(sessionGrades.createdAt));
  return rows.map(withCommittee);
}

/**
 * Make `userId` the session's one open assignment: adds theirs and drops
 * every other unsubmitted one in one batch. Submitted grades stay, and are
 * returned so the caller can say who still shows as grader.
 */
export async function reassignGrader(
  sessionId: string,
  userId: string,
): Promise<{ submitted: Account[] }> {
  const db = getDb();
  await db.batch([
    db
      .insert(sessionGrades)
      .values({ sessionId, graderUserId: userId })
      .onConflictDoNothing(),
    db
      .delete(sessionGrades)
      .where(
        and(
          eq(sessionGrades.sessionId, sessionId),
          ne(sessionGrades.graderUserId, userId),
          isNull(sessionGrades.submittedAt),
        ),
      ),
  ]);
  await mirrorSession(sessionId, { kind: "assignment", phase: null }, (s) => [
    graderWrite(s.grader),
  ]);
  return { submitted: await submittedGraders(sessionId) };
}

/** Drop every open assignment; submitted grades stay and are returned. */
export async function clearGraders(
  sessionId: string,
): Promise<{ submitted: Account[] }> {
  await getDb()
    .delete(sessionGrades)
    .where(
      and(
        eq(sessionGrades.sessionId, sessionId),
        isNull(sessionGrades.submittedAt),
      ),
    );
  await mirrorSession(sessionId, { kind: "assignment", phase: null }, (s) => [
    graderWrite(s.grader),
  ]);
  return { submitted: await submittedGraders(sessionId) };
}

/** Put a proposal on the grid; its phase is its own. Refuses a clash like moveSessionTo. */
export async function placeRfpSession(
  sessionId: string,
  startsAt: Date,
  endsAt: Date,
  locationId: string | null,
): Promise<void> {
  await assertSlotFree(sessionId, startsAt, endsAt, locationId);
  const [row] = await getDb()
    .update(sessions)
    .set({ startsAt, endsAt, locationId })
    .where(eq(sessions.id, sessionId))
    .returning({ id: sessions.id });
  if (!row) throw new Error("That session no longer exists.");
  invalidateSchedule();
}

/**
 * Take a session off the grid, keeping the row and its edits. Unplaced
 * sessions can't be published, so it drops to draft; the phase is left alone.
 */
export async function unplaceRfpSession(sessionId: string): Promise<void> {
  const [row] = await getDb()
    .update(sessions)
    .set({ startsAt: null, endsAt: null, status: "draft" })
    .where(eq(sessions.id, sessionId))
    .returning({ id: sessions.id });
  if (!row) throw new Error("That session no longer exists.");
  invalidateSchedule();
}
