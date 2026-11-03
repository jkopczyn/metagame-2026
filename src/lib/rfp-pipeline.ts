import type { RfpSession } from "./rfp-sessions";
import {
  MEGAGAME_INTEGRATION_LABELS,
  NEXT_STEPS_PHASE,
  SPEAKER_TIER_LABELS,
  VERDICT_LABELS,
} from "./rfp-labels";

// The pipeline columns as the /grade and speaker committee tables show them:
// one row per session, each select's option labels, and the pill colours.
// Plain data with a type-only import, so client components can use it.

/** The columns a row's inline dropdowns edit. */
export const PIPELINE_FIELDS = [
  "grader",
  "verdict",
  "nextSteps",
  "shepherd",
  "speakerTier",
  "megagameIntegration",
] as const;
export type PipelineField = (typeof PIPELINE_FIELDS)[number];

export type Row = {
  /** The session id. */
  id: string;
  /** For the session page the Scheduled column links to. */
  slug: string;
  title: string;
  /** The hosts' names; empty when none has one. */
  host: string;
  phase: RfpSession["phase"];
  /** On the grid: has a start time. */
  placed: boolean;
  /** Where it sits on the grid, ISO like ScheduleSession; null until placed. */
  startsAt: string | null;
  endsAt: string | null;
  locationId: string | null;
  /**
   * Placing a proposal doesn't publish it, and /schedule/<slug> only resolves
   * published sessions — so this decides whether the slot can be linked.
   */
  status: RfpSession["row"]["status"];
  /**
   * The attributed grader's label, as the Grader column shows: whoever graded
   * most recently, else the latest assignment. Any account, not only the
   * committee.
   */
  grader: string | null;
  /** That grader's account, for the Grader picker. */
  graderId: string | null;
  graderIds: string[];
  shepherd: string | null;
  shepherdId: string | null;
  /** The Verdict option label. */
  verdict: string | null;
  /** The "Next steps" option the phase stands for. */
  nextSteps: string | null;
  /** The Speaker tier option label. */
  speakerTier: string | null;
  /** The Megagame integration label; null is undecided. */
  megagameIntegration: string | null;
};

/**
 * Whether a row's slot can link to its session page. Placing a proposal from
 * the committee board doesn't publish it, and /schedule/<slug> resolves out of
 * publicSchedule(), which keeps only published sessions in a room — so a
 * placed draft, or a published session without a room, would 404.
 */
export const slotLinkable = (row: Row, scheduleReachable: boolean) =>
  scheduleReachable &&
  row.placed &&
  row.locationId !== null &&
  row.status === "published";

/** A name worth showing: null when the account only has its email. */
export const shownName = (name: string) => (name.includes("@") ? null : name);

/** How the Grader and Shepherd columns name an account. */
export const committeeLabel = (a: {
  name: string;
  committeeName: string | null;
}) => a.committeeName ?? shownName(a.name) ?? "(no name)";

/** Hosts' names for a row; empty when none has one, so it sorts like no host. */
export const hostNames = (hosts: { name: string }[]) =>
  hosts
    .map((h) => shownName(h.name))
    .filter((n): n is string => n !== null)
    .join(", ");

export function toRow(s: RfpSession): Row {
  return {
    id: s.sessionId,
    slug: s.slug,
    title: s.title,
    host: hostNames(s.hosts),
    phase: s.phase,
    placed: s.row.startsAt !== null,
    startsAt: s.row.startsAt?.toISOString() ?? null,
    endsAt: s.row.endsAt?.toISOString() ?? null,
    locationId: s.row.locationId,
    status: s.row.status,
    grader: s.grader ? committeeLabel(s.grader) : null,
    graderId: s.grader?.userId ?? null,
    graderIds: s.grades.map((g) => g.grader.userId),
    shepherd: s.shepherd ? committeeLabel(s.shepherd) : null,
    shepherdId: s.shepherd?.userId ?? null,
    verdict: s.verdict ? VERDICT_LABELS[s.verdict] : null,
    nextSteps: s.nextSteps,
    speakerTier: s.row.speakerTier
      ? SPEAKER_TIER_LABELS[s.row.speakerTier]
      : null,
    megagameIntegration: s.row.megagameIntegrationLevel
      ? MEGAGAME_INTEGRATION_LABELS[s.row.megagameIntegrationLevel]
      : null,
  };
}

/** The selects' own order, so sorting reads the way the columns do. */
export const VERDICT_ORDER: readonly string[] = Object.values(VERDICT_LABELS);
export const NEXT_STEPS_ORDER: readonly string[] =
  Object.keys(NEXT_STEPS_PHASE);
export const SPEAKER_TIER_ORDER: readonly string[] =
  Object.values(SPEAKER_TIER_LABELS);
export const MEGAGAME_INTEGRATION_ORDER: readonly string[] = Object.values(
  MEGAGAME_INTEGRATION_LABELS,
);

/** Each inline select's options, given the committee's names. */
export const pipelineOptions = (
  names: readonly string[],
): Record<PipelineField, readonly string[]> => ({
  grader: names,
  shepherd: names,
  verdict: VERDICT_ORDER,
  nextSteps: NEXT_STEPS_ORDER,
  speakerTier: SPEAKER_TIER_ORDER,
  megagameIntegration: MEGAGAME_INTEGRATION_ORDER,
});

export const SPEAKER_TIER_INFO =
  "What we offer the host: a comped ticket, travel and housing, or nothing beyond a spot on the schedule.";
export const MEGAGAME_INTEGRATION_INFO =
  "How far this session ties into the Megagame. Blank means undecided.";

export const SHEPHERD_INFO =
  "The individual responsible for emailing, meeting with, following up with, and ensuring this speaker has a good experience on an ongoing basis";

// Airtable's own option colours (see airtable-colors.ts for the tokens), so
// the pills here read the way they do in the base.
const COMMITTEE_COLORS: Record<string, string> = {
  "John Bromels": "purpleLight2",
  "Brian Smiley": "purpleLight1",
  "Ben Karcher": "yellowLight2",
  "Brendan Hurst": "yellowLight1",
  "Tommy Honton": "orangeLight2",
  "Sparr Risher": "orangeLight1",
  "Michael Sheely": "pinkLight2",
  "Ricki Heicklen": "pinkLight1",
  Jisk: "blueLight2",
  "Scott Gillies": "blueLight2",
  "Julian Wise": "blueLight2",
};

export const PIPELINE_COLORS: Record<PipelineField, Record<string, string>> = {
  grader: COMMITTEE_COLORS,
  shepherd: COMMITTEE_COLORS,
  verdict: {
    Confirmed: "greenLight1",
    Probably: "greenLight2",
    "needs follow up": "yellowLight2",
    "Unconference schedule": "purpleLight2",
    Unlikely: "redLight2",
    Rejected: "redLight1",
    "N/A": "grayLight2",
  },
  nextSteps: {
    "0. Assign grader": "tealLight2",
    "1. Grade": "cyanLight2",
    "2. Committee decision": "cyanLight1",
    "3. Email speaker with verdict": "cyanBright",
    "4. Assign shepherd": "blueLight2",
    "5. Shepherd meeting": "blueLight1",
    "6. Add to schedule": "blueBright",
    "7. None! We're good :) ": "grayLight2",
    "Not adding to schedule": "grayLight2",
  },
  speakerTier: {
    "Free ticket + flights + housing": "blueLight2",
    "Free ticket + flights": "cyanLight2",
    "Free ticket": "tealLight2",
    "They can add it to the schedule if they want, but no ticket comp":
      "greenLight2",
  },
  megagameIntegration: {
    "Deep integration": "purpleLight1",
    "Include puzzle and rewards": "blueLight1",
    "Include premade puzzle in session": "blueLight2",
    "Hand out low context rewards": "purpleLight2",
    "No integration": "grayLight2",
  },
};

/** Blank or unrecognised values sort after everything known. */
export const rank = (order: readonly string[], value: string | null) => {
  const i = value ? order.indexOf(value) : -1;
  return i === -1 ? order.length : i;
};

// Groups drop the numbering the option names carry. Anything not named here
// just loses its "N. " prefix.
const GROUP_LABELS: Record<string, string> = {
  "1. Grade": "To grade",
  "7. None! We're good :) ": "All set",
};

export const groupLabel = (step: string | null) =>
  step === null
    ? "Not triaged yet"
    : (GROUP_LABELS[step] ?? step.replace(/^\d+\.\s*/, "").trim());

/** The steps present among the rows, in pipeline order with untriaged first. */
export function stepsOf(rows: Row[]): (string | null)[] {
  return [null, ...NEXT_STEPS_ORDER].filter((step) =>
    rows.some((s) => s.nextSteps === step),
  );
}
