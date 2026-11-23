import { after } from "next/server";
import { env } from "@/env";
import { airtableConfig, airtableFetch } from "./airtable-config";
import type { GradeValues, SessionText, SessionTextKey } from "./grade-input";
import { committeeName } from "./rfp-committee";
import type { MirrorState, SpeakerTier } from "./rfp-sessions";
import {
  DROPINS_LABELS,
  GRADER_VERDICT_LABELS,
  nextStepsFor,
  POTENTIAL_PANEL_LABELS,
  RUBRIC_GRADE_LABELS,
  SHEPHERD_MATCH_LABELS,
  SPACE_OPTION_LOCATIONS,
  SPEAKER_TIER_LABELS,
  TOPIC_AREA_LABELS,
  VERDICT_LABELS,
} from "./rfp-labels";

// Postgres is the source of truth for grading; during the transition each
// write is copied onto the session's Airtable RFP row so the base stays usable.
// Best effort: a failed copy is logged and never undoes the database write.

export type Fields = Record<string, unknown>;

const label = <V extends string>(labels: Record<V, string>, v: V | null) =>
  v === null ? null : labels[v];

/** Local dev and previews would write the real base, so they skip unless asked. */
export const mirrorEnabled = () =>
  process.env.NEXT_PUBLIC_VERCEL_ENV === "production" ||
  process.env.RFP_AIRTABLE_MIRROR === "1";

export const nextStepsField = (state: MirrorState): Fields => ({
  "Next steps": nextStepsFor(state.phase, {
    graded: state.graded,
    shepherded: state.shepherd !== null,
  }),
});

export const verdictField = (state: MirrorState): Fields => ({
  Verdict: label(VERDICT_LABELS, state.verdict),
});

/** A PATCH of its own, with typecast on or off. */
export type Write = { fields: Fields; typecast: boolean };
export type MirrorGroup = Fields | Write | null;

/**
 * "Rubric: Grader" for the attributed grader, by committee name else display
 * name. Typecast is on, so a grader the select doesn't list — the committee
 * members it never had an option for included — is added to it as it saves.
 * A grader with no name to add falls back to the select's "Other", so the
 * cell never keeps naming whoever graded before.
 */
export function graderWrite(
  grader: { email: string; name: string } | null,
): Write | null {
  if (grader === null) {
    return { fields: { "Rubric: Grader": "Unassigned" }, typecast: true };
  }
  const name = committeeName(grader.email) ?? (grader.name.trim() || null);
  // An email would become a Grader option.
  const option = !name || name.includes("@") ? "Other" : name;
  return { fields: { "Rubric: Grader": option }, typecast: true };
}

/**
 * "Shepherd" for an account, by committee name else display name. Typecast is
 * on, so a new shepherd is added to the select's options as it saves.
 */
export function shepherdWrite(
  shepherd: { email: string; name: string } | null,
): Write | null {
  if (shepherd === null) return { fields: { Shepherd: null }, typecast: true };
  const name = committeeName(shepherd.email) ?? (shepherd.name.trim() || null);
  // An email would become a Shepherd option; better to leave the cell alone.
  if (!name || name.includes("@")) {
    console.warn(
      `[rfp-mirror] no name for shepherd ${shepherd.email}; skipping Shepherd`,
    );
    return null;
  }
  return { fields: { Shepherd: name }, typecast: true };
}

const SPACE_LABEL_BY_LOCATION = Object.fromEntries(
  Object.entries(SPACE_OPTION_LOCATIONS).map(([l, name]) => [name, l]),
);

/** One grade as the row's grading columns; Airtable holds a single grade. */
export function gradeFields(
  grade: GradeValues,
  spaceLocationNames: string[],
): Fields {
  return {
    "Rubric: Operational Ease": label(
      RUBRIC_GRADE_LABELS,
      grade.operationalEase,
    ),
    "Rubric: Host Competence": label(RUBRIC_GRADE_LABELS, grade.hostCompetence),
    "Rubric: Host Name Recognition": label(
      RUBRIC_GRADE_LABELS,
      grade.hostNameRecognition,
    ),
    "Rubric: Subject Matter": label(RUBRIC_GRADE_LABELS, grade.subjectMatter),
    "Rubric: Fun": label(RUBRIC_GRADE_LABELS, grade.fun),
    "Grader Verdict recomendation": label(
      GRADER_VERDICT_LABELS,
      grade.verdictRecommendation,
    ),
    "Grader notes on quality": grade.qualityNotes ?? "",
    "Grader Notes for Scheduler": grade.schedulerNotes ?? "",
    "Shepherd match potential": label(
      SHEPHERD_MATCH_LABELS,
      grade.shepherdMatch,
    ),
    "Topic areas": grade.topicAreas.map((t) => TOPIC_AREA_LABELS[t]),
    "Potential Panels": grade.potentialPanels.map(
      (p) => POTENTIAL_PANEL_LABELS[p],
    ),
    "Lighthaven Space Options": spaceLocationNames.flatMap((name) =>
      SPACE_LABEL_BY_LOCATION[name] ? [SPACE_LABEL_BY_LOCATION[name]] : [],
    ),
    "Megagame integration": grade.megagameIntegration ?? "",
    "Expected crowd size": grade.expectedCrowdSize,
    "Allow dropins?": label(DROPINS_LABELS, grade.allowDropins),
  };
}

const TEXT_FIELDS: Record<SessionTextKey, string> = {
  context: "Session Context",
  timingConstraints: "Timing constraints",
  otherConstraints: "Other Constraints",
  ageElaboration: "Age elaboration",
  applicationRequired: "Application required?",
  bespokeNeeds: "Bespoke needs?",
  anythingElse: "Anything else?",
  megagameNotes: "megagame notes",
  ticketState: "Ticket state",
  housingStatus: "Housing status",
  communicationNotes: "Communication notes",
  rickiNotes: "Ricki's notes",
  requestedDuration: "Duration",
  cohosts: "Cohost(s)",
};

/** The session columns given, as their Airtable columns. */
export function sessionFields(
  text: SessionText,
  speakerTier?: SpeakerTier | null,
  marketingConsent?: boolean | null,
): Fields {
  const out: Fields = {};
  for (const [key, value] of Object.entries(text)) {
    out[TEXT_FIELDS[key as SessionTextKey]] = value ?? "";
  }
  if (speakerTier !== undefined) {
    out["Speaker tier"] = label(SPEAKER_TIER_LABELS, speakerTier);
  }
  if (marketingConsent !== undefined) {
    out["Session marketing consent"] = marketingConsent ?? false;
  }
  return out;
}

async function patch(recordId: string, { fields, typecast }: Write) {
  const { AIRTABLE_API_KEY } = env;
  if (!AIRTABLE_API_KEY) throw new Error("Airtable is not configured");
  const res = await airtableFetch(
    `https://api.airtable.com/v0/${airtableConfig.baseId}/${airtableConfig.rfpSubmissionsTableId}/${recordId}`,
    {
      method: "PATCH",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields, typecast }),
    },
  );
  if (!res.ok) {
    throw new Error(`Airtable responded ${res.status}: ${await res.text()}`);
  }
}

const isWrite = (g: Fields | Write): g is Write =>
  "typecast" in g && typeof g.typecast === "boolean" && "fields" in g;

/**
 * Copy fields onto the RFP row once the response is sent. Each group is its
 * own PATCH, so one rejected value doesn't sink the rest. Plain fields go with
 * typecast off: a label that isn't an option fails instead of minting one.
 */
export function mirror(
  recordId: string | null,
  ...groups: MirrorGroup[]
): void {
  if (!recordId) return;
  const writes = groups
    .filter((g): g is Fields | Write => g !== null)
    .map((g) => (isWrite(g) ? g : { fields: g, typecast: false }))
    .filter((w) => Object.keys(w.fields).length > 0);
  if (writes.length === 0) return;
  if (!mirrorEnabled()) {
    console.info(
      `[rfp-mirror] off here; would write ${recordId}:`,
      JSON.stringify(writes),
    );
    return;
  }
  const task = async () => {
    for (const write of writes) {
      try {
        await patch(recordId, write);
      } catch (err) {
        console.error(`[rfp-mirror] ${recordId} failed:`, err);
      }
    }
  };
  try {
    after(task);
  } catch {
    // Outside a request (a script), so there's no response to wait for.
    void task();
  }
}
