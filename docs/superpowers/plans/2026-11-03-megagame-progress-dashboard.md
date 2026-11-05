# Megagame Progress Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a progress page for the design team at `/backstage/megagame/dashboard` that shows concentration of completions and level-ups, classes side by side, level transitions and join cohorts, computed in memory from the live event log, together with the current level grid and the CSV exports.

**Architecture:** The volunteer branch is now a single Quest Board page at `/backstage/megagame` and has no dashboard directory, so everything under `src/app/backstage/megagame/dashboard/` is new or restored from commit 6487c9f. Three store queries load every live completion, every live level event and the claimed-ticket holder ids in one HTTP request each; a fourth loads the players (everyone with a level above 0, plus the ids behind the events). A new pure module, `src/lib/megagame-progress.ts`, turns those arrays plus the range's buckets and `now` into every table the page shows, including the level grid. The page is an async server component; each section is a synchronous component with inline SVG charts whose geometry lives in a small tested `.ts` module.

**Tech Stack:** Next.js 16.4 (app router, server components), React 19, Drizzle over Neon (neon-http), Vitest 5, Tailwind classes as in the existing backstage pages.

**Spec:** `docs/superpowers/specs/2026-11-03-megagame-progress-dashboard-design.md`. Read it before starting any task. Section numbers below ("spec 4", "spec 6") refer to it. The Quest Board revision is described in section 12 of `docs/superpowers/specs/2026-10-28-megagame-volunteer-tool-design.md`.

## Global Constraints

- Work only in the worktree `/home/jkop/Code/metagame-2026/.worktrees/megagame-dashboard` (branch `megagame-dashboard`, based on the revised `megagame-volunteer` at commit 5be83f7). Never `cd` to the main checkout.
- `node_modules` is installed. Reach pnpm as `corepack pnpm` with `PATH="$HOME/.local/node/bin:$PATH"`; every command below is written that way. Do not run `pnpm install`.
- Before writing any page or component code, read the relevant guide in `node_modules/next/dist/docs/` (CLAUDE.md: "This is NOT the Next.js you know"). The Quest Board page uses `connection()` from `next/server` and the global `PageProps<"/route">` type produced by `next typegen`; the export route uses the global `RouteContext<"/route">`. Keep using all three.
- No schema change. No change to the Quest Board's sections, the picker, `src/app/backstage/megagame/over-time/*`, `OverTime.tsx` or `data.ts`. The only Quest Board change is the manager-only "Dashboard" link (Task 14).
- Old file contents are read with `git show 6487c9f:<path>`. When a step says "restore X from 6487c9f", run `git show 6487c9f:<path> > <path>` and then apply the stated changes.
- `src/lib/megagame-progress.ts` must not import `@/db`, `drizzle-orm`, `server-only`, or `./megagame-store`. It may import `./megagame-levels`, `./megagame-rules` and `./schedule`.
- Route `/backstage/megagame/dashboard`, gated on `toolAccess("megagame.manage")`. Unpermitted viewers get `<SignIn next={viewHref(view, {})} />` and nothing is loaded. The restored export route `/backstage/megagame/dashboard/export/[table]` is gated on `megagame.manage` too.
- The page makes four store requests, no more: `liveCompletionLog()`, `liveLevelEventLog()`, `claimedTicketHolderIds()`, then `progressPlayers(ids)`. The level grid is computed from the players in memory; `levelGrid()` is not called.
- Range presets `2h`, `today`, `con`; bucket sizes from `BUCKET_SIZES` in `src/lib/megagame-rules.ts`. Refresh every 60 s with the dashboard's own `AutoRefresh`.
- Share thresholds 10, 20 and 50 percent; Gini as the single inequality figure; 25 rows in the most-active table (spec 13).
- Charts are inline SVG with an `aria-label` and a table fallback, and they show on phones as well as desktop (spec 9). No `hidden sm:block` wrappers on charts. No charting dependency. The dashboard may import `Legend`, `StackedBars`, `CLASS_COLORS` and `ANY_CLASS_COLOR` from `../over-time/charts` but must not change that file; its own chart components go in `dashboard/charts.tsx`.
- An empty range (zero buckets, for example "today" at Pacific midnight) renders the page normally; every bucketed view shows an empty-state sentence with no chart and no endpoint labels.
- Section components and `LevelGrid` are synchronous functions (not `async`), so tests can render them with `renderToStaticMarkup`. Only `page.tsx` is async. Section components do not use `next/link`; links stay in `page.tsx`.
- Comments: minimal, only for a non-obvious reason (CLAUDE.md).
- Vitest only picks up `src/**/*.test.ts` (see `vitest.config.ts`). Component tests are `.test.ts` files that render with `createElement` and `renderToStaticMarkup`, following `src/app/(v2)/account/MegagamePanel.test.ts`.
- Run one test file with `corepack pnpm exec vitest run <path>`. The pre-commit hook runs lint-staged, which runs Prettier on the staged files, so no separate Prettier step is needed.
- No commit may leave the test suite red or the typecheck failing. Each task ends with `corepack pnpm typecheck` (which runs `next typegen && tsc --noEmit`) and the tests it touches passing, then a commit. End every commit message with the Co-Authored-By line that the executing session's instructions specify.
- Times are compared as instants (`getTime()`); "as of t" always means events strictly before t.

## Decisions this plan makes where the spec is silent

Implementation agents follow these; they are listed here so reviewers can object to them in one place. Items marked "(settled)" were decided after review on 2026-11-03 and are not to be reopened.

1. **What the range picker affects (settled).** The range and bucket pickers drive only the bucketed views: the concentration-over-time series (spec 4.3), the per-bucket class table and the cumulative level bars (spec 5). The headline figures, Lorenz curves, most-active table, level transitions and cohorts use every live row loaded, which is the state as of now. The page says this next to the pickers.
2. **Deleted accounts.** All rows with a null `user_id` are one pseudo-player keyed `DELETED_PLAYER`. It is included in concentration (spec 4) and in the per-bucket class counts (spec 5). It is excluded from the cumulative level bars (as the old dashboard page did at 6487c9f, since `liveLevelEventsBefore` dropped null users), from level transitions and current-level medians (its events come from several people, so durations between them mean nothing), and from cohorts.
3. **Unknown quest classes.** A completion whose quest class is null or is not one of `MEGAGAME_CLASSES` counts as any-class: in overall figures and the any-class column only. A level event whose class is not a megagame class, or whose level is outside 1 to `MAX_LEVEL`, is ignored everywhere.
4. **Quartiles** use linear interpolation between closest ranks (the method numpy calls "linear"): position `p * (m - 1)` in the ascending list of `m` values.
5. **Transitions.** For each real player and class, take the earliest live event at each level (any source), sort by level, and look at consecutive pairs `(a, b)`. If the later level's event is earlier in time than the lower level's, the pair is ignored. If `b = a + 1` it is a made transition with duration `max(0, t_b - max(t_a, CON_START))`. If `b > a + 1` it is counted once in the `skipped` column of the row for `a -> a+1` and contributes no duration. A gap of more than one level (1 to 4) is also one skip on the row starting at `a`.
6. **Class activity (settled).** "Distinct players active in that class" counts a completion of a class quest or a live volunteer level event in that class. Picker joins are not activity, matching the cohort rule. The share of current members can exceed 100 percent (a deleted account, or a player who switched class, is active but not a current member); the page shows the number as computed.
7. **Totals row** of the class table: completions and level-ups are sums over the range; active players is the distinct count over the whole range, not a sum.
8. **Most active.** Ranked among players with at least one live completion. First and last activity are the earliest and latest live completion or live volunteer level-up. Ties on completions are broken by earliest first activity, then by player key, so the order is fully deterministic.
9. **Cohorts.** Rows are every con day (always shown, even when empty) plus any other Pacific day on which some player's first activity fell (for example test data before the con), sorted by day. Retention cells exist only for con days strictly after the cohort day; others are null. "Reached level 2 or higher" uses the player's current level columns. Volunteer level-ups per player are shown as a mean only. A cohort of size 0 has null statistics.
10. **Claimed-ticket holders.** The "not yet active" count needs the holders' ids, so a new store query `claimedTicketHolderIds()` replaces `claimedTicketHolderCount()`; the level grid's denominator is `holderIds.length`. A grep on 2026-11-03 found no caller of `claimedTicketHolderCount` outside the store and its test, so it is removed in Task 13.
11. **Level grid in memory (settled).** `progressPlayers(ids)` already returns every player with a level above 0 in any class, which is every player the grid counts, so the grid is computed from its result by `levelGridOf(players)` in the pure module. `levelGrid()` is not called and is removed in Task 13.
12. **Removal scope (settled rule, list computed 2026-11-03).** Removed: store queries that nothing outside `megagame-store.ts` and its test calls once the new page is in place, and that were kept only for a later dashboard. A grep after the rebase gives exactly: `levelGrid`, `claimedTicketHolderCount`, `questCompletionCounts` (with `QuestCount`), `distinctCompletingPlayers`, `completionsByVolunteer` (with `VolunteerCount`), `liveLevelEventsBefore`, and `recentOverrides` (with `OverrideRow`; overrides now appear among the Quest Board's recent actions). **Kept:** `completionSeries`, `levelEventSeries`, the private `dateBin`, `recentVoids` and `VoidRow` (the Quest Board's `data.ts` calls them); `exportEventTable` (the restored export route calls it); `listQuests`, `importQuests` and `levelEventsFor`, which are also uncalled after the rebase but belong to quest import and the per-player level view, not to the dashboard (the volunteer spec section 12 keeps the quest import queries for a later script). `bucketIntervalSql` and `BUCKET_ORIGIN` stay in `megagame-rules.ts`.
13. **Dashboard view, refresh and export (settled).** The dashboard gets its own `dashboard/view.ts` restored from 6487c9f without the `cls` class picker, its own `dashboard/AutoRefresh.tsx` restored from 6487c9f, and the export route and its test restored from 6487c9f with the gate changed from `megagame.verify` to `megagame.manage`. `over-time/view.ts` is not reused because its `viewHref` builds Quest Board URLs.
14. **Dashboard link (settled).** The Quest Board's `page.tsx` already resolves `manager` with `toolAccess("megagame.manage")`, and the layout has no access check and no nav, so the link goes in `page.tsx`: a right-aligned "Dashboard" link above the quest section, rendered only when `viewer.manager` is true. The `megagame.verify` permission description stops mentioning the dashboard and the `megagame.manage` description mentions it. Each is its own commit.
15. **Page order.** Title and pickers, level grid, concentration, classes, transitions, cohorts, export.
16. **Page width.** The Quest Board layout wraps pages in a `max-w-xl` column. The dashboard page widens itself with `w-[min(64rem,calc(100vw-2rem))] self-center`, as the old dashboard page did, and every table sits in an `overflow-x-auto` box.

---

## File structure

Create:

- `src/lib/megagame-progress.ts`: types and pure computations for spec 4 to 7 and the level grid.
- `src/lib/megagame-progress.test.ts`
- `src/app/backstage/megagame/dashboard/view.ts` and `view.test.ts`: restored from 6487c9f without `cls`, plus formatting helpers.
- `src/app/backstage/megagame/dashboard/chart-geometry.ts` and `chart-geometry.test.ts`: point and segment math for the SVG charts.
- `src/app/backstage/megagame/dashboard/export/[table]/route.ts` and `route.test.ts`: restored from 6487c9f, gated on `megagame.manage`.
- `src/app/backstage/megagame/dashboard/AutoRefresh.tsx`: restored from 6487c9f unchanged.
- `src/app/backstage/megagame/dashboard/page.tsx` and `page.test.ts`
- `src/app/backstage/megagame/dashboard/styles.ts`: shared table class strings.
- `src/app/backstage/megagame/dashboard/charts.tsx`: `LorenzPlot`, `LineChart`, `ClassLevelBars`.
- `src/app/backstage/megagame/dashboard/LevelGrid.tsx`
- `src/app/backstage/megagame/dashboard/ConcentrationSection.tsx`
- `src/app/backstage/megagame/dashboard/ClassesSection.tsx`
- `src/app/backstage/megagame/dashboard/TransitionsSection.tsx`
- `src/app/backstage/megagame/dashboard/CohortsSection.tsx`
- `src/app/backstage/megagame/dashboard/sections.test.ts`: render tests for `LevelGrid` and the section components.

Modify:

- `src/lib/megagame-store.ts`: add four queries in the "Dashboard" section (after the `// ---- Dashboard ----` comment); later remove the dead ones listed in "Decisions" 12.
- `src/lib/megagame-store.test.ts`: tests for the new queries; remove tests of removed queries.
- `src/app/backstage/megagame/page.tsx` and `pages.test.ts`: the manager-only "Dashboard" link.
- `src/lib/permissions.ts`: the two megagame descriptions.

Read but do not change: `src/app/backstage/megagame/over-time/charts.tsx` (imported), `src/app/backstage/megagame/layout.tsx`, `OverTime.tsx`, `data.ts`.

---

## Shared types (the contract between tasks)

Every task that touches the progress module or its consumers uses exactly these names. They are all exported from `src/lib/megagame-progress.ts`.

```ts
export type ProgressCompletion = {
  userId: string | null;
  /** The quest's class; null for an any-class quest. */
  class: string | null;
  confirmedAt: Date;
};

export type ProgressLevelEvent = {
  userId: string | null;
  class: string;
  level: number;
  /** "picker" or "volunteer". */
  source: string;
  awardedAt: Date;
};

export type ProgressPlayer = {
  id: string;
  name: string;
  /** The user table's level columns. */
  levels: MegagameLevels;
};

export const DELETED_PLAYER: string; // "\u0000deleted"
export function playerKey(userId: string | null): string;
export const CON_START: Date; // 2026-11-06T08:00:00.000Z, midnight Pacific on CONFERENCE_DAYS[0]
export const SHARE_PERCENTS: readonly [10, 20, 50];
export const MOST_ACTIVE_LIMIT: 25;

// Concentration (Task 1)
export type ShareSummary = {
  players: number;
  total: number;
  top10: number; // fractions in [0, 1]
  top20: number;
  top50: number;
  gini: number;
};
export type LorenzPoint = { x: number; y: number };
export type ConcentrationPoint = {
  end: Date;
  players: number;
  completions: number;
  top20: number;
  gini: number;
};
export type ActivePlayerRow = {
  key: string;
  userId: string | null;
  /** null for the deleted-accounts pseudo-player or an id with no user row. */
  name: string | null;
  levels: MegagameLevels;
  completions: number;
  byClass: Record<MegagameClass, number>;
  anyClass: number;
  levelUps: number;
  firstActivity: Date;
  lastActivity: Date;
};
export type Concentration = {
  completions: ShareSummary;
  byClass: Record<MegagameClass, ShareSummary>;
  levelUps: ShareSummary;
  lorenz: {
    overall: LorenzPoint[];
    byClass: Record<MegagameClass, LorenzPoint[]>;
  };
  series: ConcentrationPoint[];
  mostActive: ActivePlayerRow[];
};
export function topShare(counts: readonly number[], percent: number): number;
export function gini(counts: readonly number[]): number;
export function shareSummary(counts: readonly number[]): ShareSummary;
export function lorenzPoints(counts: readonly number[]): LorenzPoint[];
export function rankPlayers(
  counts: ReadonlyMap<string, number>,
  firstActivity: ReadonlyMap<string, Date>,
): string[];
export function concentration(
  completions: readonly ProgressCompletion[],
  levelEvents: readonly ProgressLevelEvent[],
  players: readonly ProgressPlayer[],
  ends: readonly Date[],
): Concentration;

// Classes (Task 2)
export type ClassCell = {
  completions: number;
  levelUps: number;
  activePlayers: number;
  /** activePlayers / current members; null when the class has no members. */
  memberShare: number | null;
};
export type ClassRow = {
  start: Date;
  end: Date;
  byClass: Record<MegagameClass, ClassCell>;
  anyClass: number;
};
export type ClassTable = {
  members: Record<MegagameClass, number>;
  rows: ClassRow[];
  totals: { byClass: Record<MegagameClass, ClassCell>; anyClass: number };
};
export function bucketEnds(
  buckets: readonly Date[],
  size: BucketSize,
  to: Date,
): Date[];
export function classTable(
  completions: readonly ProgressCompletion[],
  levelEvents: readonly ProgressLevelEvent[],
  players: readonly ProgressPlayer[],
  buckets: readonly Date[],
  ends: readonly Date[],
): ClassTable;
export function cumulativeLevels(
  levelEvents: readonly ProgressLevelEvent[],
  ends: readonly Date[],
): Record<MegagameClass, number[]>[];

// Transitions (Task 3)
export type TransitionRow = {
  class: MegagameClass;
  from: number; // 1..4
  to: number; // from + 1
  made: number;
  skipped: number;
  /** Durations in milliseconds; null when made is 0. */
  q25: number | null;
  median: number | null;
  q75: number | null;
};
export type CurrentLevelRow = {
  class: MegagameClass;
  level: number; // 1..5
  players: number;
  withEvent: number;
  /** Milliseconds; null when withEvent is 0. */
  medianSince: number | null;
};
export type Transitions = { rows: TransitionRow[]; current: CurrentLevelRow[] };
export function quantile(sorted: readonly number[], p: number): number | null;
export function clampToCon(at: Date): number;
export function transitions(
  levelEvents: readonly ProgressLevelEvent[],
  players: readonly ProgressPlayer[],
  now: Date,
): Transitions;

// Cohorts (Task 4)
export type CohortRow = {
  day: string; // "2026-11-06"
  size: number;
  completionsMean: number | null;
  completionsMedian: number | null;
  levelUpsMean: number | null;
  reachedLevel2Share: number | null;
  /** One cell per CONFERENCE_DAYS entry; null unless that day is after `day`. */
  retention: (number | null)[];
};
export type CohortTable = {
  /** CONFERENCE_DAYS keys, the retention columns. */
  days: string[];
  rows: CohortRow[];
  holders: number;
  notYetActive: number;
  notYetActiveShare: number | null;
};
export function cohorts(
  completions: readonly ProgressCompletion[],
  levelEvents: readonly ProgressLevelEvent[],
  players: readonly ProgressPlayer[],
  holderIds: readonly string[],
): CohortTable;

// Whole page (Task 4)
export type ProgressInput = {
  completions: readonly ProgressCompletion[];
  levelEvents: readonly ProgressLevelEvent[];
  players: readonly ProgressPlayer[];
  holderIds: readonly string[];
  /** Bucket starts from dashboardView; empty when the range has too many. */
  buckets: readonly Date[];
  size: BucketSize;
  /** The range's exclusive end. */
  to: Date;
  now: Date;
};
export type Progress = {
  ends: Date[];
  /** Players per current level in each class; index = level, index 0 unused. */
  grid: Record<MegagameClass, number[]>;
  concentration: Concentration;
  classes: ClassTable;
  cumulative: Record<MegagameClass, number[]>[];
  transitions: Transitions;
  cohorts: CohortTable;
};
export function activeUserIds(
  completions: readonly ProgressCompletion[],
  levelEvents: readonly ProgressLevelEvent[],
): string[];
export function levelGridOf(
  players: readonly ProgressPlayer[],
): Record<MegagameClass, number[]>;
export function computeProgress(input: ProgressInput): Progress;
```

---

## Milestone A: the pure module

### Task 1: Module skeleton and concentration (spec 4)

**Files:**

- Create: `src/lib/megagame-progress.ts`
- Create: `src/lib/megagame-progress.test.ts`

**Interfaces:**

- Consumes: `MEGAGAME_CLASSES`, `NO_LEVELS`, `isMegagameClass`, `MegagameClass`, `MegagameLevels` from `src/lib/megagame-levels.ts`; `CONFERENCE_DAYS`, `fromPacificWall` from `src/lib/schedule.ts` (lines 284 and 358).
- Produces: the base types, `DELETED_PLAYER`, `playerKey`, `CON_START`, `SHARE_PERCENTS`, `MOST_ACTIVE_LIMIT`, `topShare`, `gini`, `shareSummary`, `lorenzPoints`, `rankPlayers`, `concentration`, and the Concentration types, all as in "Shared types".

Definitions to implement (spec 4):

- Top-k% share: with `n` players and `total` counts, `m = Math.ceil((k * n) / 100)` computed in integers (never `k / 100 * n`, which gives `Math.ceil(0.1 * 30) = 4`). The share is the sum of the `m` largest counts over `total`. It is 0 when `n` or `total` is 0. The value does not depend on how ties are ordered; `rankPlayers` makes the listing order deterministic.
- Gini: sort counts ascending as `x_1 .. x_n`; `G = 2 * Σ(i * x_i) / (n * Σ x_i) - (n + 1) / n`. It is 0 when `n < 2` or the sum is 0.
- Lorenz points: counts ascending; points `(0, 0)` then `(i / n, cumulative_i / total)` for `i = 1..n`. Empty when `n` or `total` is 0.
- Active player: at least one live completion. Leveling player: at least one live event with source `volunteer`.
- Series: for each end `e`, counts per player of completions with `confirmedAt < e`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  CON_START,
  DELETED_PLAYER,
  concentration,
  gini,
  lorenzPoints,
  playerKey,
  rankPlayers,
  shareSummary,
  topShare,
  type ProgressCompletion,
  type ProgressLevelEvent,
  type ProgressPlayer,
} from "./megagame-progress";
import { NO_LEVELS } from "./megagame-levels";

const at = (iso: string) => new Date(iso);
const done = (
  userId: string | null,
  cls: string | null,
  iso: string,
): ProgressCompletion => ({ userId, class: cls, confirmedAt: at(iso) });
const ev = (
  userId: string | null,
  cls: string,
  level: number,
  source: "picker" | "volunteer",
  iso: string,
): ProgressLevelEvent => ({
  userId,
  class: cls,
  level,
  source,
  awardedAt: at(iso),
});
const player = (
  id: string,
  levels: Partial<ProgressPlayer["levels"]> = {},
): ProgressPlayer => ({
  id,
  name: id.toUpperCase(),
  levels: { ...NO_LEVELS, ...levels },
});

describe("constants", () => {
  it("starts the con at midnight Pacific on the first con day", () => {
    expect(CON_START.toISOString()).toBe("2026-11-06T08:00:00.000Z");
  });

  it("keys deleted accounts as one pseudo-player", () => {
    expect(playerKey(null)).toBe(DELETED_PLAYER);
    expect(playerKey("u1")).toBe("u1");
  });
});

describe("topShare", () => {
  it("takes ceil(k% of n) players", () => {
    expect(topShare([5, 3, 1, 1], 10)).toBe(0.5);
    expect(topShare([5, 3, 1, 1], 20)).toBe(0.5);
    expect(topShare([5, 3, 1, 1], 50)).toBe(0.8);
  });

  it("does not round 10% of 30 players up to 4", () => {
    expect(topShare(new Array(30).fill(1), 10)).toBe(0.1);
  });

  it("is 0 for no players and 1 for one player", () => {
    expect(topShare([], 20)).toBe(0);
    expect(topShare([4], 10)).toBe(1);
  });
});

describe("gini", () => {
  it("matches the mean-absolute-difference definition", () => {
    expect(gini([1, 3])).toBeCloseTo(0.25, 10);
    expect(gini([1, 1, 2, 4])).toBeCloseTo(0.3125, 10);
    expect(gini([3, 2, 1, 1])).toBeCloseTo(0.25, 10);
  });

  it("is 0 for equal counts and for fewer than two players", () => {
    expect(gini([2, 2, 2, 2])).toBe(0);
    expect(gini([7])).toBe(0);
    expect(gini([])).toBe(0);
  });
});

describe("shareSummary", () => {
  it("reports players, total, the three shares and Gini", () => {
    const s = shareSummary([3, 2, 1, 1]);
    expect(s).toMatchObject({ players: 4, total: 7 });
    expect(s.top10).toBeCloseTo(3 / 7, 10);
    expect(s.top20).toBeCloseTo(3 / 7, 10);
    expect(s.top50).toBeCloseTo(5 / 7, 10);
    expect(s.gini).toBeCloseTo(0.25, 10);
  });

  it("is all zeros when empty", () => {
    expect(shareSummary([])).toEqual({
      players: 0,
      total: 0,
      top10: 0,
      top20: 0,
      top50: 0,
      gini: 0,
    });
  });
});

describe("lorenzPoints", () => {
  it("runs from (0,0) to (1,1) over the ascending counts", () => {
    expect(lorenzPoints([3, 1])).toEqual([
      { x: 0, y: 0 },
      { x: 0.5, y: 0.25 },
      { x: 1, y: 1 },
    ]);
  });

  it("is empty with no counts", () => {
    expect(lorenzPoints([])).toEqual([]);
  });
});

describe("rankPlayers", () => {
  it("sorts by count, then earliest first activity, then key", () => {
    const counts = new Map([
      ["late", 1],
      ["early", 1],
      ["top", 3],
      ["b", 1],
      ["a", 1],
    ]);
    const first = new Map([
      ["late", at("2026-11-06T21:00:00.000Z")],
      ["early", at("2026-11-06T17:00:00.000Z")],
      ["top", at("2026-11-06T22:00:00.000Z")],
      ["b", at("2026-11-06T23:00:00.000Z")],
      ["a", at("2026-11-06T23:00:00.000Z")],
    ]);
    expect(rankPlayers(counts, first)).toEqual([
      "top",
      "early",
      "late",
      "a",
      "b",
    ]);
  });
});

describe("concentration", () => {
  // u1: 3 completions (one any-class), deleted accounts: 2, u2: 1, u3: 1.
  const completions = [
    done("u1", "wizard", "2026-11-06T18:00:00.000Z"),
    done("u1", "wizard", "2026-11-06T19:00:00.000Z"),
    done("u1", null, "2026-11-06T20:00:00.000Z"),
    done("u2", "pirate", "2026-11-06T17:00:00.000Z"),
    done("u3", "wizard", "2026-11-06T21:00:00.000Z"),
    done(null, "wizard", "2026-11-06T22:00:00.000Z"),
    done(null, "pirate", "2026-11-06T23:00:00.000Z"),
  ];
  const levelEvents = [
    ev("u1", "wizard", 2, "volunteer", "2026-11-06T19:30:00.000Z"),
    ev("u1", "wizard", 3, "volunteer", "2026-11-07T19:00:00.000Z"),
    ev("u2", "pirate", 2, "volunteer", "2026-11-07T01:00:00.000Z"),
    ev("u3", "wizard", 1, "picker", "2026-11-06T10:00:00.000Z"),
  ];
  const players = [
    player("u1", { wizard: 3 }),
    player("u2", { pirate: 2 }),
    player("u3", { wizard: 1 }),
  ];
  const ends = [at("2026-11-06T20:00:00.000Z"), at("2026-11-07T00:00:00.000Z")];
  const c = concentration(completions, levelEvents, players, ends);

  it("counts deleted accounts as one player", () => {
    expect(c.completions.players).toBe(4);
    expect(c.completions.total).toBe(7);
    expect(c.completions.top20).toBeCloseTo(3 / 7, 10);
    expect(c.completions.top50).toBeCloseTo(5 / 7, 10);
    expect(c.completions.gini).toBeCloseTo(0.25, 10);
  });

  it("counts any-class completions in overall only", () => {
    expect(c.byClass.wizard).toMatchObject({ players: 3, total: 4 });
    expect(c.byClass.pirate).toMatchObject({ players: 2, total: 2 });
    expect(c.byClass.alien).toMatchObject({ players: 0, total: 0 });
    expect(c.lorenz.overall.at(-1)).toEqual({ x: 1, y: 1 });
    expect(c.lorenz.byClass.wizard).toHaveLength(4);
    expect(c.lorenz.byClass.alien).toEqual([]);
  });

  it("measures level-ups over leveling players, volunteer events only", () => {
    expect(c.levelUps).toMatchObject({ players: 2, total: 3 });
    expect(c.levelUps.top10).toBeCloseTo(2 / 3, 10);
    expect(c.levelUps.gini).toBeCloseTo(1 / 6, 10);
  });

  it("builds the series from events strictly before each end", () => {
    expect(c.series).toHaveLength(2);
    expect(c.series[0]).toMatchObject({ players: 2, completions: 3 });
    expect(c.series[0].top20).toBeCloseTo(2 / 3, 10);
    expect(c.series[0].gini).toBeCloseTo(1 / 6, 10);
    expect(c.series[1]).toMatchObject({ players: 4, completions: 7 });
    expect(c.series[1].top20).toBeCloseTo(3 / 7, 10);
  });

  it("lists the most active players with ties broken by first activity", () => {
    expect(c.mostActive.map((r) => r.key)).toEqual([
      "u1",
      DELETED_PLAYER,
      "u2",
      "u3",
    ]);
    const [u1, deleted] = c.mostActive;
    expect(u1).toMatchObject({
      userId: "u1",
      name: "U1",
      completions: 3,
      byClass: { wizard: 2, pirate: 0, alien: 0 },
      anyClass: 1,
      levelUps: 2,
      levels: { wizard: 3, pirate: 0, alien: 0 },
    });
    expect(u1.firstActivity.toISOString()).toBe("2026-11-06T18:00:00.000Z");
    expect(u1.lastActivity.toISOString()).toBe("2026-11-07T19:00:00.000Z");
    expect(deleted).toMatchObject({
      userId: null,
      name: null,
      levels: NO_LEVELS,
    });
  });

  it("keeps at most 25 rows", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      done(`p${i}`, "alien", "2026-11-06T18:00:00.000Z"),
    );
    expect(concentration(many, [], [], []).mostActive).toHaveLength(25);
  });

  it("handles no data", () => {
    const empty = concentration([], [], [], [at("2026-11-06T20:00:00.000Z")]);
    expect(empty.completions.players).toBe(0);
    expect(empty.lorenz.overall).toEqual([]);
    expect(empty.mostActive).toEqual([]);
    expect(empty.series[0]).toMatchObject({ players: 0, top20: 0, gini: 0 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm exec vitest run src/lib/megagame-progress.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write the implementation**

Put the "Shared types" declarations for this task in the file, then:

```ts
// Pure computations for the megagame progress dashboard: concentration,
// classes, level transitions and cohorts. No database imports; the page
// loads live rows through megagame-store.ts and passes them in.

import {
  MEGAGAME_CLASSES,
  NO_LEVELS,
  isMegagameClass,
  type MegagameClass,
  type MegagameLevels,
} from "./megagame-levels";
import { CONFERENCE_DAYS, fromPacificWall } from "./schedule";

export const DELETED_PLAYER = "\u0000deleted";
export const playerKey = (userId: string | null): string =>
  userId ?? DELETED_PLAYER;

export const CON_START: Date = fromPacificWall(
  `${CONFERENCE_DAYS[0].key}T00:00`,
)!;

export const SHARE_PERCENTS = [10, 20, 50] as const;
export const MOST_ACTIVE_LIMIT = 25;

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

const perClass = <T>(make: () => T): Record<MegagameClass, T> =>
  Object.fromEntries(MEGAGAME_CLASSES.map((c) => [c, make()])) as Record<
    MegagameClass,
    T
  >;

/** The class a completion counts toward, or null for any-class. */
const questClass = (cls: string | null): MegagameClass | null =>
  isMegagameClass(cls) ? cls : null;

const isLevelUp = (e: ProgressLevelEvent) => e.source === "volunteer";

export function topShare(counts: readonly number[], percent: number): number {
  const total = sum(counts);
  if (counts.length === 0 || total === 0) return 0;
  const m = Math.ceil((percent * counts.length) / 100);
  const top = [...counts].sort((a, b) => b - a).slice(0, m);
  return sum(top) / total;
}

export function gini(counts: readonly number[]): number {
  const n = counts.length;
  const total = sum(counts);
  if (n < 2 || total === 0) return 0;
  const sorted = [...counts].sort((a, b) => a - b);
  let weighted = 0;
  sorted.forEach((x, i) => (weighted += (i + 1) * x));
  return (2 * weighted) / (n * total) - (n + 1) / n;
}

export function shareSummary(counts: readonly number[]): ShareSummary {
  return {
    players: counts.length,
    total: sum(counts),
    top10: topShare(counts, 10),
    top20: topShare(counts, 20),
    top50: topShare(counts, 50),
    gini: gini(counts),
  };
}

export function lorenzPoints(counts: readonly number[]): LorenzPoint[] {
  const total = sum(counts);
  if (counts.length === 0 || total === 0) return [];
  const sorted = [...counts].sort((a, b) => a - b);
  const out: LorenzPoint[] = [{ x: 0, y: 0 }];
  let running = 0;
  sorted.forEach((c, i) => {
    running += c;
    out.push({ x: (i + 1) / sorted.length, y: running / total });
  });
  return out;
}

const LATEST = Number.MAX_SAFE_INTEGER;

export function rankPlayers(
  counts: ReadonlyMap<string, number>,
  firstActivity: ReadonlyMap<string, Date>,
): string[] {
  const first = (k: string) => firstActivity.get(k)?.getTime() ?? LATEST;
  return [...counts.keys()].sort(
    (a, b) =>
      counts.get(b)! - counts.get(a)! ||
      first(a) - first(b) ||
      (a < b ? -1 : a > b ? 1 : 0),
  );
}

function bump(map: Map<string, number>, key: string, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

const perClassFrom = <T>(f: (cls: MegagameClass) => T) =>
  Object.fromEntries(MEGAGAME_CLASSES.map((c) => [c, f(c)])) as Record<
    MegagameClass,
    T
  >;

function widen(
  first: Map<string, Date>,
  last: Map<string, Date>,
  key: string,
  at: Date,
) {
  const f = first.get(key);
  if (!f || at < f) first.set(key, at);
  const l = last.get(key);
  if (!l || at > l) last.set(key, at);
}

export function concentration(
  completions: readonly ProgressCompletion[],
  levelEvents: readonly ProgressLevelEvent[],
  players: readonly ProgressPlayer[],
  ends: readonly Date[],
): Concentration {
  const overall = new Map<string, number>();
  const byClass = perClass(() => new Map<string, number>());
  const anyClass = new Map<string, number>();
  const levelUps = new Map<string, number>();
  const first = new Map<string, Date>();
  const last = new Map<string, Date>();

  for (const c of completions) {
    const key = playerKey(c.userId);
    bump(overall, key);
    const cls = questClass(c.class);
    if (cls) bump(byClass[cls], key);
    else bump(anyClass, key);
    widen(first, last, key, c.confirmedAt);
  }
  for (const e of levelEvents) {
    if (!isLevelUp(e) || !isMegagameClass(e.class)) continue;
    const key = playerKey(e.userId);
    bump(levelUps, key);
    widen(first, last, key, e.awardedAt);
  }

  const byId = new Map(players.map((p) => [p.id, p]));
  const mostActive = rankPlayers(overall, first)
    .slice(0, MOST_ACTIVE_LIMIT)
    .map((key): ActivePlayerRow => {
      const userId = key === DELETED_PLAYER ? null : key;
      const p = userId ? byId.get(userId) : undefined;
      return {
        key,
        userId,
        name: p?.name ?? null,
        levels: p?.levels ?? NO_LEVELS,
        completions: overall.get(key) ?? 0,
        byClass: perClassFrom((cls) => byClass[cls].get(key) ?? 0),
        anyClass: anyClass.get(key) ?? 0,
        levelUps: levelUps.get(key) ?? 0,
        firstActivity: first.get(key)!,
        lastActivity: last.get(key)!,
      };
    });

  const series = ends.map((end): ConcentrationPoint => {
    const counts = new Map<string, number>();
    for (const c of completions)
      if (c.confirmedAt < end) bump(counts, playerKey(c.userId));
    const values = [...counts.values()];
    return {
      end,
      players: values.length,
      completions: sum(values),
      top20: topShare(values, 20),
      gini: gini(values),
    };
  });

  return {
    completions: shareSummary([...overall.values()]),
    byClass: perClassFrom((cls) => shareSummary([...byClass[cls].values()])),
    levelUps: shareSummary([...levelUps.values()]),
    lorenz: {
      overall: lorenzPoints([...overall.values()]),
      byClass: perClassFrom((cls) => lorenzPoints([...byClass[cls].values()])),
    },
    series,
    mostActive,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm exec vitest run src/lib/megagame-progress.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/megagame-progress.ts src/lib/megagame-progress.test.ts
git commit -m "feat(megagame): concentration math for the progress dashboard"
```

### Task 2: Classes side by side and cumulative levels (spec 5)

**Files:**

- Modify: `src/lib/megagame-progress.ts`
- Modify: `src/lib/megagame-progress.test.ts`

**Interfaces:**

- Consumes: Task 1's types, `playerKey`, `perClass`, `perClassFrom`, `questClass`, `isLevelUp`; `BUCKET_MINUTES`, `cumulativeLevelDistribution`, `BucketSize` from `src/lib/megagame-rules.ts` (lines 276 and 339).
- Produces: `bucketEnds`, `classTable`, `cumulativeLevels`, `ClassCell`, `ClassRow`, `ClassTable`.

Rules:

- `bucketEnds`: end of bucket `i` is `min(start_i + BUCKET_MINUTES[size] minutes, to)`. This is the old dashboard page's computation (`git show 6487c9f:src/app/backstage/megagame/dashboard/page.tsx`, lines 139 to 142).
- A completion or level event belongs to row `i` when `start_i <= t < end_i`.
- Per class cell: `completions` counts completions whose quest class is that class; `levelUps` counts volunteer events in that class; `activePlayers` counts distinct player keys with a completion of a class quest or a volunteer level event in that class (picker joins are not activity, "Decisions" 6); `memberShare = activePlayers / members[cls]`, null when `members[cls]` is 0.
- `members[cls]`: players in `players` with `levels[cls] >= 1`.
- `anyClass`: completions whose class is null or not a megagame class.
- Totals: the same cell computation over `[buckets[0], ends.at(-1))`; with no buckets, zero cells (memberShare 0 or null by the same rule) and `anyClass` 0.
- `cumulativeLevels`: drop events with a null `userId`, map the rest to `DatedLevelEvent` and call `cumulativeLevelDistribution(events, ends)`. Picker joins are level 1 events already, so they count as level 1 from their time.

- [ ] **Step 1: Write the failing tests** (append to `megagame-progress.test.ts`; add `bucketEnds`, `classTable`, `cumulativeLevels` to the import)

```ts
describe("bucketEnds", () => {
  it("ends each bucket one size later, cut at the range end", () => {
    const ends = bucketEnds(
      [at("2026-11-06T17:00:00.000Z"), at("2026-11-06T18:00:00.000Z")],
      "1h",
      at("2026-11-06T18:30:00.000Z"),
    );
    expect(ends.map((d) => d.toISOString())).toEqual([
      "2026-11-06T18:00:00.000Z",
      "2026-11-06T18:30:00.000Z",
    ]);
  });
});

describe("classTable", () => {
  const completions = [
    done("u2", "pirate", "2026-11-06T17:00:00.000Z"),
    done("u1", "wizard", "2026-11-06T18:00:00.000Z"),
    done("u1", null, "2026-11-06T18:20:00.000Z"),
    done("u1", "wizard", "2026-11-06T19:00:00.000Z"), // after the range end
  ];
  const levelEvents = [
    ev("u3", "wizard", 1, "picker", "2026-11-06T18:10:00.000Z"),
    ev("u1", "wizard", 2, "volunteer", "2026-11-06T18:15:00.000Z"),
  ];
  const players = [
    player("u1", { wizard: 2 }),
    player("u2", { pirate: 1 }),
    player("u3", { wizard: 1 }),
  ];
  const buckets = [
    at("2026-11-06T17:00:00.000Z"),
    at("2026-11-06T18:00:00.000Z"),
  ];
  const ends = [at("2026-11-06T18:00:00.000Z"), at("2026-11-06T18:30:00.000Z")];
  const t = classTable(completions, levelEvents, players, buckets, ends);

  it("counts current members from the level columns", () => {
    expect(t.members).toEqual({ wizard: 2, pirate: 1, alien: 0 });
  });

  it("fills each bucket by class, with any-class completions apart", () => {
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0].byClass).toEqual({
      wizard: { completions: 0, levelUps: 0, activePlayers: 0, memberShare: 0 },
      pirate: { completions: 1, levelUps: 0, activePlayers: 1, memberShare: 1 },
      alien: {
        completions: 0,
        levelUps: 0,
        activePlayers: 0,
        memberShare: null,
      },
    });
    expect(t.rows[0].anyClass).toBe(0);
    // u1 completes and levels up; u3's picker join is not activity: one active wizard of two members.
    expect(t.rows[1].byClass.wizard).toEqual({
      completions: 1,
      levelUps: 1,
      activePlayers: 1,
      memberShare: 0.5,
    });
    expect(t.rows[1].anyClass).toBe(1);
  });

  it("totals sum counts and count distinct players over the range", () => {
    expect(t.totals.byClass.wizard).toEqual({
      completions: 1,
      levelUps: 1,
      activePlayers: 1,
      memberShare: 0.5,
    });
    expect(t.totals.byClass.pirate.completions).toBe(1);
    expect(t.totals.anyClass).toBe(1);
  });

  it("has no rows and zero totals with no buckets", () => {
    const none = classTable(completions, levelEvents, players, [], []);
    expect(none.rows).toEqual([]);
    expect(none.totals.byClass.wizard).toEqual({
      completions: 0,
      levelUps: 0,
      activePlayers: 0,
      memberShare: 0,
    });
  });
});

describe("cumulativeLevels", () => {
  it("counts picker joins as level 1 from their time and drops deleted accounts", () => {
    const levelEvents = [
      ev("u3", "wizard", 1, "picker", "2026-11-06T18:10:00.000Z"),
      ev("u1", "wizard", 2, "volunteer", "2026-11-06T18:15:00.000Z"),
      ev(null, "wizard", 3, "volunteer", "2026-11-06T18:00:00.000Z"),
    ];
    const out = cumulativeLevels(levelEvents, [
      at("2026-11-06T18:12:00.000Z"),
      at("2026-11-06T18:30:00.000Z"),
    ]);
    expect(out[0].wizard).toEqual([0, 1, 0, 0, 0, 0]);
    expect(out[1].wizard).toEqual([0, 1, 1, 0, 0, 0]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm exec vitest run src/lib/megagame-progress.test.ts`
Expected: FAIL, `bucketEnds` is not exported.

- [ ] **Step 3: Write the implementation**

```ts
import {
  BUCKET_MINUTES,
  cumulativeLevelDistribution,
  type BucketSize,
  type DatedLevelEvent,
} from "./megagame-rules";

export function bucketEnds(
  buckets: readonly Date[],
  size: BucketSize,
  to: Date,
): Date[] {
  const step = BUCKET_MINUTES[size] * 60_000;
  return buckets.map(
    (b) => new Date(Math.min(b.getTime() + step, to.getTime())),
  );
}

function classCells(
  completions: readonly ProgressCompletion[],
  levelEvents: readonly ProgressLevelEvent[],
  members: Record<MegagameClass, number>,
  start: number,
  end: number,
): { byClass: Record<MegagameClass, ClassCell>; anyClass: number } {
  const inWindow = (d: Date) => d.getTime() >= start && d.getTime() < end;
  const counts = perClass(() => ({ completions: 0, levelUps: 0 }));
  const active = perClass(() => new Set<string>());
  let anyClass = 0;
  for (const c of completions) {
    if (!inWindow(c.confirmedAt)) continue;
    const cls = questClass(c.class);
    if (!cls) {
      anyClass++;
      continue;
    }
    counts[cls].completions++;
    active[cls].add(playerKey(c.userId));
  }
  for (const e of levelEvents) {
    if (!inWindow(e.awardedAt) || !isLevelUp(e) || !isMegagameClass(e.class))
      continue;
    counts[e.class].levelUps++;
    active[e.class].add(playerKey(e.userId));
  }
  return {
    byClass: perClassFrom((cls) => ({
      ...counts[cls],
      activePlayers: active[cls].size,
      memberShare: members[cls] > 0 ? active[cls].size / members[cls] : null,
    })),
    anyClass,
  };
}

export function classTable(
  completions: readonly ProgressCompletion[],
  levelEvents: readonly ProgressLevelEvent[],
  players: readonly ProgressPlayer[],
  buckets: readonly Date[],
  ends: readonly Date[],
): ClassTable {
  const members = perClassFrom(
    (cls) => players.filter((p) => p.levels[cls] >= 1).length,
  );
  const rows = buckets.map(
    (start, i): ClassRow => ({
      start,
      end: ends[i],
      ...classCells(
        completions,
        levelEvents,
        members,
        start.getTime(),
        ends[i].getTime(),
      ),
    }),
  );
  const totals =
    buckets.length === 0
      ? classCells([], [], members, 0, 0)
      : classCells(
          completions,
          levelEvents,
          members,
          buckets[0].getTime(),
          ends.at(-1)!.getTime(),
        );
  return { members, rows, totals };
}

export function cumulativeLevels(
  levelEvents: readonly ProgressLevelEvent[],
  ends: readonly Date[],
): Record<MegagameClass, number[]>[] {
  const dated: DatedLevelEvent[] = levelEvents.flatMap((e) =>
    e.userId === null
      ? []
      : [
          {
            userId: e.userId,
            class: e.class,
            level: e.level,
            awardedAt: e.awardedAt,
          },
        ],
  );
  return cumulativeLevelDistribution(dated, ends);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm exec vitest run src/lib/megagame-progress.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/megagame-progress.ts src/lib/megagame-progress.test.ts
git commit -m "feat(megagame): per-bucket class figures and cumulative levels"
```

### Task 3: Level transitions (spec 6)

**Files:**

- Modify: `src/lib/megagame-progress.ts`
- Modify: `src/lib/megagame-progress.test.ts`

**Interfaces:**

- Consumes: Task 1's types, `CON_START`, `perClass`, `perClassFrom`; `MAX_LEVEL`.
- Produces: `quantile`, `clampToCon`, `transitions`, `TransitionRow`, `CurrentLevelRow`, `Transitions`.

Rules (see also "Decisions" 2, 4 and 5):

- `quantile(sorted, p)`: null for an empty list; otherwise with `pos = p * (m - 1)`, `lo = floor(pos)`, `hi = ceil(pos)`, return `sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)`.
- `clampToCon(at) = max(at.getTime(), CON_START.getTime())`, in milliseconds.
- For each player with a non-null `userId` and each megagame class, keep the earliest live event time at each level 1 to `MAX_LEVEL`, from any source.
- Made transition `a -> a+1`: duration `max(0, t_{a+1} - clampToCon(t_a))`.
- `rows`: for each class in `MEGAGAME_CLASSES` order, `from` = 1 to 4; quartiles over the made durations.
- `current`: for each class in order and each level 1 to 5, `players` = players whose level column equals that level; `withEvent` = those with a live event at that level in that class; `medianSince` = median of `max(0, now - clampToCon(t))` over those with an event.

- [ ] **Step 1: Write the failing tests** (append; add `quantile`, `transitions` to the import)

```ts
const H = 3_600_000;

describe("quantile", () => {
  it("interpolates between closest ranks", () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4], 0.75)).toBe(3.25);
    expect(quantile([5], 0.25)).toBe(5);
    expect(quantile([], 0.5)).toBeNull();
  });
});

describe("transitions", () => {
  const levelEvents = [
    // p1 joined before the con: time at level 1 counts from con start (08:00Z).
    ev("p1", "wizard", 1, "picker", "2026-11-01T12:00:00.000Z"),
    ev("p1", "wizard", 2, "volunteer", "2026-11-06T10:00:00.000Z"),
    ev("p1", "wizard", 3, "volunteer", "2026-11-06T14:00:00.000Z"),
    ev("p2", "wizard", 1, "picker", "2026-11-06T09:00:00.000Z"),
    ev("p2", "wizard", 2, "volunteer", "2026-11-06T13:00:00.000Z"),
    // p3 skips level 2.
    ev("p3", "wizard", 1, "picker", "2026-11-06T09:00:00.000Z"),
    ev("p3", "wizard", 3, "volunteer", "2026-11-06T12:00:00.000Z"),
    ev("p4", "wizard", 1, "picker", "2026-11-06T10:00:00.000Z"),
    ev("p4", "wizard", 2, "volunteer", "2026-11-06T16:00:00.000Z"),
    // Level 2 before level 1: ignored.
    ev("p5", "wizard", 2, "volunteer", "2026-11-06T09:00:00.000Z"),
    ev("p5", "wizard", 1, "picker", "2026-11-06T11:00:00.000Z"),
    // Deleted accounts: ignored.
    ev(null, "wizard", 1, "picker", "2026-11-06T09:00:00.000Z"),
    ev(null, "wizard", 2, "volunteer", "2026-11-06T09:30:00.000Z"),
    ev("p7", "pirate", 1, "picker", "2026-11-01T12:00:00.000Z"),
  ];
  const players = [
    player("p1", { wizard: 3 }),
    player("p2", { wizard: 2 }),
    player("p3", { wizard: 3 }),
    player("p4", { wizard: 2 }),
    player("p6", { wizard: 2 }), // no event behind this level
    player("p7", { pirate: 1 }),
  ];
  const now = at("2026-11-06T20:00:00.000Z");
  const t = transitions(levelEvents, players, now);
  const row = (cls: string, from: number) =>
    t.rows.find((r) => r.class === cls && r.from === from)!;
  const cur = (cls: string, level: number) =>
    t.current.find((r) => r.class === cls && r.level === level)!;

  it("has a row per class and transition, in order", () => {
    expect(t.rows).toHaveLength(12);
    expect(t.rows.slice(0, 4).map((r) => [r.class, r.from, r.to])).toEqual([
      ["wizard", 1, 2],
      ["wizard", 2, 3],
      ["wizard", 3, 4],
      ["wizard", 4, 5],
    ]);
  });

  it("clamps the start to con start and takes quartiles of the made durations", () => {
    expect(row("wizard", 1)).toEqual({
      class: "wizard",
      from: 1,
      to: 2,
      made: 3,
      skipped: 1,
      q25: 3 * H,
      median: 4 * H,
      q75: 5 * H,
    });
    expect(row("wizard", 2)).toMatchObject({
      made: 1,
      skipped: 0,
      median: 4 * H,
    });
  });

  it("leaves empty transitions at zero with null durations", () => {
    expect(row("pirate", 1)).toMatchObject({
      made: 0,
      skipped: 0,
      q25: null,
      median: null,
      q75: null,
    });
  });

  it("counts players at each current level, with the median over those with an event", () => {
    expect(cur("wizard", 2)).toEqual({
      class: "wizard",
      level: 2,
      players: 3,
      withEvent: 2,
      medianSince: 5.5 * H,
    });
    expect(cur("wizard", 3)).toMatchObject({
      players: 2,
      withEvent: 2,
      medianSince: 7 * H,
    });
    expect(cur("wizard", 1)).toMatchObject({
      players: 0,
      withEvent: 0,
      medianSince: null,
    });
    expect(cur("pirate", 1)).toMatchObject({ players: 1, medianSince: 12 * H });
  });

  it("never reports a negative time before the con", () => {
    const early = transitions(
      levelEvents,
      players,
      at("2026-11-02T00:00:00.000Z"),
    );
    expect(
      early.current.find((r) => r.class === "pirate" && r.level === 1)!
        .medianSince,
    ).toBe(0);
  });
});
```

The expected numbers: wizard 1 to 2 durations are p1 2h (10:00 minus con start 08:00), p2 4h, p4 6h, so q25 3h, median 4h, q75 5h. At now 20:00Z, wizard level 2 holders with events are p2 (since 13:00, 7h) and p4 (since 16:00, 4h), median 5.5h; level 3 holders are p1 (since 14:00, 6h) and p3 (since 12:00, 8h), median 7h; p7's pre-con join counts from con start, 12h.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm exec vitest run src/lib/megagame-progress.test.ts`
Expected: FAIL, `transitions` is not exported.

- [ ] **Step 3: Write the implementation** (add `MAX_LEVEL` to the `./megagame-levels` import)

```ts
export function quantile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const pos = p * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export const clampToCon = (at: Date): number =>
  Math.max(at.getTime(), CON_START.getTime());

const LEVELS = Array.from({ length: MAX_LEVEL }, (_, i) => i + 1);

/** Earliest live event time per real player and class, by level. */
function levelTimes(
  levelEvents: readonly ProgressLevelEvent[],
): Map<string, Map<number, Date>> {
  const out = new Map<string, Map<number, Date>>();
  for (const e of levelEvents) {
    if (e.userId === null || !isMegagameClass(e.class)) continue;
    if (!Number.isInteger(e.level) || e.level < 1 || e.level > MAX_LEVEL)
      continue;
    const key = `${e.class}\u0000${e.userId}`;
    const byLevel = out.get(key) ?? new Map<number, Date>();
    const seen = byLevel.get(e.level);
    if (!seen || e.awardedAt < seen) byLevel.set(e.level, e.awardedAt);
    out.set(key, byLevel);
  }
  return out;
}

export function transitions(
  levelEvents: readonly ProgressLevelEvent[],
  players: readonly ProgressPlayer[],
  now: Date,
): Transitions {
  const times = levelTimes(levelEvents);
  const durations = perClass(() => LEVELS.map((): number[] => []));
  const skipped = perClass(() => LEVELS.map(() => 0));
  for (const [key, byLevel] of times) {
    const cls = key.split("\u0000")[0] as MegagameClass;
    const levels = [...byLevel.keys()].sort((a, b) => a - b);
    for (let i = 0; i + 1 < levels.length; i++) {
      const a = levels[i];
      const b = levels[i + 1];
      const ta = byLevel.get(a)!;
      const tb = byLevel.get(b)!;
      if (tb < ta) continue;
      if (b === a + 1)
        durations[cls][a].push(Math.max(0, tb.getTime() - clampToCon(ta)));
      else skipped[cls][a]++;
    }
  }

  const rows: TransitionRow[] = MEGAGAME_CLASSES.flatMap((cls) =>
    LEVELS.slice(0, -1).map((from) => {
      const sorted = [...durations[cls][from]].sort((x, y) => x - y);
      return {
        class: cls,
        from,
        to: from + 1,
        made: sorted.length,
        skipped: skipped[cls][from],
        q25: quantile(sorted, 0.25),
        median: quantile(sorted, 0.5),
        q75: quantile(sorted, 0.75),
      };
    }),
  );

  const current: CurrentLevelRow[] = MEGAGAME_CLASSES.flatMap((cls) =>
    LEVELS.map((level) => {
      const at = players.filter((p) => p.levels[cls] === level);
      const since = at
        .flatMap((p) => {
          const t = times.get(`${cls}\u0000${p.id}`)?.get(level);
          return t ? [Math.max(0, now.getTime() - clampToCon(t))] : [];
        })
        .sort((x, y) => x - y);
      return {
        class: cls,
        level,
        players: at.length,
        withEvent: since.length,
        medianSince: quantile(since, 0.5),
      };
    }),
  );

  return { rows, current };
}
```

`durations[cls]` and `skipped[cls]` are indexed by level with index 0 unused; `LEVELS.map` gives `MAX_LEVEL` slots, so index `a` up to 4 exists. If an implementer finds the off-by-one confusing, allocate `MAX_LEVEL + 1` slots instead; the tests are the same.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm exec vitest run src/lib/megagame-progress.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/megagame-progress.ts src/lib/megagame-progress.test.ts
git commit -m "feat(megagame): level transition durations with the con-start clamp"
```

### Task 4: Cohorts and the whole-page computation (spec 7)

**Files:**

- Modify: `src/lib/megagame-progress.ts`
- Modify: `src/lib/megagame-progress.test.ts`

**Interfaces:**

- Consumes: everything from Tasks 1 to 3; `pacificDayKey` from `src/lib/schedule.ts` (line 337; it takes an ISO string).
- Produces: `cohorts`, `CohortRow`, `CohortTable`, `activeUserIds`, `levelGridOf`, `computeProgress`, `ProgressInput`, `Progress`.

Rules (see "Decisions" 2 and 9):

- Activity: a live completion or a live volunteer level event in a megagame class, by a non-null user. Picker joins are not activity.
- Cohort day: `pacificDayKey(firstActivity.toISOString())`.
- Rows: the union of `CONFERENCE_DAYS` keys and cohort days present, sorted ascending.
- Per row: `size`; completions per member (members with no completions count as 0) as mean and median (`quantile(sorted, 0.5)`); volunteer level-ups per member as mean; `reachedLevel2Share` = members whose current `levels` (from `players`; `NO_LEVELS` if missing) have any class at 2 or more, over size; `retention[j]` for `CONFERENCE_DAYS[j]`: null unless that key is greater than the row's day, otherwise members with any activity on that Pacific day, over size. Size 0 gives null for every statistic and every retention cell.
- `holders = new Set(holderIds).size`; `notYetActive` = holders not among the cohort members; `notYetActiveShare` = `notYetActive / holders`, null when there are no holders.
- `activeUserIds`: distinct non-null user ids from completions then level events, in first-appearance order.
- `levelGridOf(players)`: for each class an array of `MAX_LEVEL + 1` zeros; each player with `levels[cls]` between 1 and `MAX_LEVEL` adds 1 at that index. This is the shape the removed `levelGrid()` query returned, computed from the players the page already loads ("Decisions" 11).
- `computeProgress`: `ends = bucketEnds(buckets, size, to)`, `grid = levelGridOf(players)`, then each section function with the arrays as given; `cumulative = cumulativeLevels(levelEvents, ends)`; `transitions(levelEvents, players, now)`.

- [ ] **Step 1: Write the failing tests** (append; add `activeUserIds`, `cohorts`, `computeProgress`, `levelGridOf` to the import)

```ts
describe("cohorts", () => {
  const completions = [
    done("A", "wizard", "2026-11-06T20:00:00.000Z"), // Fri 12:00 PT
    done("A", null, "2026-11-07T18:00:00.000Z"), // Sat 10:00 PT
    done("D", "pirate", "2026-11-07T08:00:00.000Z"), // Sat 00:00 PT exactly
    done("D", "pirate", "2026-11-08T19:00:00.000Z"), // Sun 11:00 PT
    done(null, null, "2026-11-06T20:00:00.000Z"), // deleted: no cohort
  ];
  const levelEvents = [
    ev("B", "pirate", 1, "picker", "2026-11-06T09:00:00.000Z"),
    ev("B", "pirate", 2, "volunteer", "2026-11-07T07:30:00.000Z"), // Fri 23:30 PT
    ev("C", "alien", 1, "picker", "2026-11-06T10:00:00.000Z"), // picker only
  ];
  const players = [
    player("A", { wizard: 2 }),
    player("B", { pirate: 2 }),
    player("C", { alien: 1 }),
    player("D", { pirate: 1 }),
  ];
  const t = cohorts(completions, levelEvents, players, ["A", "C", "D", "H"]);
  const day = (key: string) => t.rows.find((r) => r.day === key)!;

  it("has a row per con day and the con days as retention columns", () => {
    expect(t.days).toEqual(["2026-11-06", "2026-11-07", "2026-11-08"]);
    expect(t.rows.map((r) => r.day)).toEqual(t.days);
  });

  it("puts a player in the Pacific day of their first completion or volunteer level-up", () => {
    expect(day("2026-11-06")).toEqual({
      day: "2026-11-06",
      size: 2, // A, and B at 23:30 Friday Pacific
      completionsMean: 1,
      completionsMedian: 1,
      levelUpsMean: 0.5,
      reachedLevel2Share: 1,
      retention: [null, 0.5, 0],
    });
    expect(day("2026-11-07")).toEqual({
      day: "2026-11-07",
      size: 1, // D at midnight Pacific
      completionsMean: 2,
      completionsMedian: 2,
      levelUpsMean: 0,
      reachedLevel2Share: 0,
      retention: [null, null, 1],
    });
  });

  it("leaves an empty cohort with null statistics", () => {
    expect(day("2026-11-08")).toEqual({
      day: "2026-11-08",
      size: 0,
      completionsMean: null,
      completionsMedian: null,
      levelUpsMean: null,
      reachedLevel2Share: null,
      retention: [null, null, null],
    });
  });

  it("counts holders with no activity as not yet active; picker joins do not count", () => {
    expect(t).toMatchObject({
      holders: 4,
      notYetActive: 2,
      notYetActiveShare: 0.5,
    });
  });

  it("adds a row for a day outside the con and gives it every con day as retention", () => {
    const pre = cohorts(
      [done("E", "alien", "2026-11-05T20:00:00.000Z")],
      [],
      [],
      [],
    );
    expect(pre.rows[0]).toMatchObject({
      day: "2026-11-05",
      size: 1,
      retention: [0, 0, 0],
    });
    expect(pre.notYetActiveShare).toBeNull();
  });
});

describe("activeUserIds", () => {
  it("lists distinct real users in first-appearance order", () => {
    expect(
      activeUserIds(
        [
          done("u2", null, "2026-11-06T18:00:00.000Z"),
          done(null, null, "2026-11-06T18:00:00.000Z"),
        ],
        [
          ev("u1", "wizard", 1, "picker", "2026-11-06T09:00:00.000Z"),
          ev("u2", "wizard", 2, "volunteer", "2026-11-06T19:00:00.000Z"),
        ],
      ),
    ).toEqual(["u2", "u1"]);
  });
});

describe("levelGridOf", () => {
  it("counts players per current level in each class, ignoring level 0", () => {
    const grid = levelGridOf([
      player("a", { wizard: 2 }),
      player("b", { wizard: 2, pirate: 1 }),
      player("c", { alien: 5 }),
      player("d"),
    ]);
    expect(grid).toEqual({
      wizard: [0, 0, 2, 0, 0, 0],
      pirate: [0, 1, 0, 0, 0, 0],
      alien: [0, 0, 0, 0, 0, 1],
    });
  });
});

describe("computeProgress", () => {
  it("returns every section for empty input", () => {
    const p = computeProgress({
      completions: [],
      levelEvents: [],
      players: [],
      holderIds: [],
      buckets: [at("2026-11-06T17:00:00.000Z")],
      size: "1h",
      to: at("2026-11-06T17:30:00.000Z"),
      now: at("2026-11-06T17:30:00.000Z"),
    });
    expect(p.ends.map((d) => d.toISOString())).toEqual([
      "2026-11-06T17:30:00.000Z",
    ]);
    expect(p.grid.wizard).toEqual([0, 0, 0, 0, 0, 0]);
    expect(p.concentration.series).toHaveLength(1);
    expect(p.classes.rows).toHaveLength(1);
    expect(p.cumulative).toHaveLength(1);
    expect(p.transitions.rows).toHaveLength(12);
    expect(p.transitions.current).toHaveLength(15);
    expect(p.cohorts.rows.map((r) => r.size)).toEqual([0, 0, 0]);
  });

  it("leaves the bucketed views empty when there are no buckets", () => {
    const p = computeProgress({
      completions: [done("u1", "wizard", "2026-11-06T18:00:00.000Z")],
      levelEvents: [],
      players: [],
      holderIds: [],
      buckets: [],
      size: "5m",
      to: at("2026-11-07T00:00:00.000Z"),
      now: at("2026-11-07T00:00:00.000Z"),
    });
    expect(p.concentration.series).toEqual([]);
    expect(p.classes.rows).toEqual([]);
    expect(p.cumulative).toEqual([]);
    expect(p.concentration.completions.players).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm exec vitest run src/lib/megagame-progress.test.ts`
Expected: FAIL, `cohorts` is not exported.

- [ ] **Step 3: Write the implementation**

```ts
// Extend the existing ./schedule import to:
import { CONFERENCE_DAYS, fromPacificWall, pacificDayKey } from "./schedule";

const dayOf = (d: Date) => pacificDayKey(d.toISOString());
const mean = (xs: readonly number[]) =>
  xs.length ? sum(xs) / xs.length : null;

export function cohorts(
  completions: readonly ProgressCompletion[],
  levelEvents: readonly ProgressLevelEvent[],
  players: readonly ProgressPlayer[],
  holderIds: readonly string[],
): CohortTable {
  const first = new Map<string, Date>();
  const days = new Map<string, Set<string>>();
  const completed = new Map<string, number>();
  const leveled = new Map<string, number>();
  const touch = (id: string, at: Date) => {
    const f = first.get(id);
    if (!f || at < f) first.set(id, at);
    const set = days.get(id) ?? new Set<string>();
    set.add(dayOf(at));
    days.set(id, set);
  };
  for (const c of completions) {
    if (c.userId === null) continue;
    bump(completed, c.userId);
    touch(c.userId, c.confirmedAt);
  }
  for (const e of levelEvents) {
    if (e.userId === null || !isLevelUp(e) || !isMegagameClass(e.class))
      continue;
    bump(leveled, e.userId);
    touch(e.userId, e.awardedAt);
  }

  const conDays = CONFERENCE_DAYS.map((d) => d.key as string);
  const members = new Map<string, string[]>();
  for (const [id, at] of first) {
    const key = dayOf(at);
    members.set(key, [...(members.get(key) ?? []), id]);
  }
  const levelsOf = new Map(players.map((p) => [p.id, p.levels]));
  const rowDays = [...new Set([...conDays, ...members.keys()])].sort();

  const rows = rowDays.map((day): CohortRow => {
    const ids = members.get(day) ?? [];
    const size = ids.length;
    const share = (n: number) => (size ? n / size : null);
    const comps = ids.map((id) => completed.get(id) ?? 0).sort((a, b) => a - b);
    return {
      day,
      size,
      completionsMean: mean(comps),
      completionsMedian: quantile(comps, 0.5),
      levelUpsMean: mean(ids.map((id) => leveled.get(id) ?? 0)),
      reachedLevel2Share: share(
        ids.filter((id) =>
          MEGAGAME_CLASSES.some((c) => (levelsOf.get(id) ?? NO_LEVELS)[c] >= 2),
        ).length,
      ),
      retention: conDays.map((d) =>
        size && d > day
          ? ids.filter((id) => days.get(id)!.has(d)).length / size
          : null,
      ),
    };
  });

  const holders = new Set(holderIds);
  const notYetActive = [...holders].filter((id) => !first.has(id)).length;
  return {
    days: conDays,
    rows,
    holders: holders.size,
    notYetActive,
    notYetActiveShare: holders.size ? notYetActive / holders.size : null,
  };
}

export function activeUserIds(
  completions: readonly ProgressCompletion[],
  levelEvents: readonly ProgressLevelEvent[],
): string[] {
  const ids = new Set<string>();
  for (const c of completions) if (c.userId) ids.add(c.userId);
  for (const e of levelEvents) if (e.userId) ids.add(e.userId);
  return [...ids];
}

export function levelGridOf(
  players: readonly ProgressPlayer[],
): Record<MegagameClass, number[]> {
  const grid = perClass(() => new Array<number>(MAX_LEVEL + 1).fill(0));
  for (const p of players)
    for (const c of MEGAGAME_CLASSES) {
      const level = p.levels[c];
      if (level >= 1 && level <= MAX_LEVEL) grid[c][level]++;
    }
  return grid;
}

export function computeProgress(input: ProgressInput): Progress {
  const { completions, levelEvents, players, buckets } = input;
  const ends = bucketEnds(buckets, input.size, input.to);
  return {
    ends,
    grid: levelGridOf(players),
    concentration: concentration(completions, levelEvents, players, ends),
    classes: classTable(completions, levelEvents, players, buckets, ends),
    cumulative: cumulativeLevels(levelEvents, ends),
    transitions: transitions(levelEvents, players, input.now),
    cohorts: cohorts(completions, levelEvents, players, input.holderIds),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm exec vitest run src/lib/megagame-progress.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/megagame-progress.ts src/lib/megagame-progress.test.ts
git commit -m "feat(megagame): join cohorts and the progress computation"
```

---

## Milestone B: store queries

### Task 5: Load queries with mocked-DB tests

**Files:**

- Modify: `src/lib/megagame-store.ts` (the Dashboard section, which starts at the `// ---- Dashboard ----` comment after `levelEventsFor`; put the new queries directly under that comment)
- Modify: `src/lib/megagame-store.test.ts` (the import list from `./megagame-store`, lines 51 to 82; add the `describe` blocks after `describe("recentLevelUps", ...)` and before `describe("levelGrid", ...)`, around line 869)

**Interfaces:**

- Consumes: `ProgressCompletion`, `ProgressLevelEvent`, `ProgressPlayer` types (`import type` from `./megagame-progress`).
- Produces:
  - `liveCompletionLog(): Promise<ProgressCompletion[]>`
  - `liveLevelEventLog(): Promise<ProgressLevelEvent[]>`
  - `progressPlayers(ids: readonly string[]): Promise<ProgressPlayer[]>`
  - `claimedTicketHolderIds(): Promise<string[]>`

The mock in `megagame-store.test.ts` (lines 1 to 98) records each chained call; `chainOf(db.select, i)` gets the i-th select chain, `arg(c, "where")` its `where` argument, and `render`/`dialect.sqlToQuery` turn SQL into text. Follow the existing `levelGrid` and `claimedTicketHolderCount` tests (lines 869 to 905), which Task 13 later removes.

- [ ] **Step 1: Write the failing tests**

Add `claimedTicketHolderIds`, `liveCompletionLog`, `liveLevelEventLog` and `progressPlayers` to the existing import list, then add:

```ts
describe("liveCompletionLog", () => {
  it("reads every live completion with its quest's class", async () => {
    const at = new Date("2026-11-06T18:00:00.000Z");
    queue([{ userId: null, class: "wizard", confirmedAt: at }]);
    expect(await liveCompletionLog()).toEqual([
      { userId: null, class: "wizard", confirmedAt: at },
    ]);
    const c = chainOf(db.select, 0);
    expect(c.calls.find((call) => call[0] === "innerJoin")?.[1]).toBe(
      schema.quests,
    );
    const where = render(arg(c, "where"));
    expect(where).toBe('"quest_completions"."voided_at" is null');
  });
});

describe("liveLevelEventLog", () => {
  it("reads every live level event, deleted accounts included", async () => {
    queue([]);
    await liveLevelEventLog();
    const where = render(arg(chainOf(db.select, 0), "where"));
    expect(where).toBe('"level_events"."voided_at" is null');
    const fields = Object.keys(
      (db.select.mock.calls[0] as unknown as [Record<string, unknown>])[0],
    );
    expect(fields).toEqual(["userId", "class", "level", "source", "awardedAt"]);
  });
});

describe("progressPlayers", () => {
  it("reads players in any class plus the given ids, once each", async () => {
    queue([{ id: "u1", name: "Ada", wizard: 2, pirate: 0, alien: 1 }]);
    expect(await progressPlayers(["u1", "u1", "u2"])).toEqual([
      { id: "u1", name: "Ada", levels: { wizard: 2, pirate: 0, alien: 1 } },
    ]);
    const where = dialect.sqlToQuery(
      arg(chainOf(db.select, 0), "where") as SQL,
    );
    expect(where.sql).toContain('"user"."wizard_level" > $');
    expect(where.sql).toContain('"user"."id" in ($');
    expect(where.params).toEqual([0, 0, 0, "u1", "u2"]);
  });

  it("skips the id list when there are no ids", async () => {
    queue([]);
    await progressPlayers([]);
    const where = render(arg(chainOf(db.select, 0), "where"));
    expect(where).not.toContain('"user"."id" in');
  });
});

describe("claimedTicketHolderIds", () => {
  it("lists distinct owners of paid tickets", async () => {
    queue([{ id: "u1" }, { id: null }, { id: "u2" }]);
    expect(await claimedTicketHolderIds()).toEqual(["u1", "u2"]);
    const c = chainOf(db.select, 0);
    const where = dialect.sqlToQuery(arg(c, "where") as SQL);
    expect(where.sql).toContain('"tickets"."owner_user_id" is not null');
    expect(where.params).toContain("paid");
    expect(c.calls.some((call) => call[0] === "groupBy")).toBe(true);
  });
});
```

If the rendered `where` for the two log queries is wrapped differently by the Drizzle version installed (for example in parentheses), relax `toBe` to `toContain`; the point of the test is that the voided filter is present and, for level events, that there is no `user_id is not null` filter.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm exec vitest run src/lib/megagame-store.test.ts`
Expected: FAIL, the four functions are not exported.

- [ ] **Step 3: Write the implementation** (the type import goes with the other imports at the top of `megagame-store.ts`; the functions go under `// ---- Dashboard ----`)

```ts
import type {
  ProgressCompletion,
  ProgressLevelEvent,
  ProgressPlayer,
} from "./megagame-progress";

/** Every live completion with its quest's class, for the progress page. */
export async function liveCompletionLog(): Promise<ProgressCompletion[]> {
  const { questCompletions, quests } = schema;
  return getDb()
    .select({
      userId: questCompletions.userId,
      class: quests.class,
      confirmedAt: questCompletions.confirmedAt,
    })
    .from(questCompletions)
    .innerJoin(quests, eq(quests.id, questCompletions.questId))
    .where(isNull(questCompletions.voidedAt));
}

/** Every live level event, deleted accounts included, for the progress page. */
export async function liveLevelEventLog(): Promise<ProgressLevelEvent[]> {
  const { levelEvents } = schema;
  return getDb()
    .select({
      userId: levelEvents.userId,
      class: levelEvents.class,
      level: levelEvents.level,
      source: levelEvents.source,
      awardedAt: levelEvents.awardedAt,
    })
    .from(levelEvents)
    .where(isNull(levelEvents.voidedAt));
}

/** Names and level columns of everyone in a class plus these ids. */
export async function progressPlayers(
  ids: readonly string[],
): Promise<ProgressPlayer[]> {
  const { user } = schema;
  const unique = [...new Set(ids)];
  const rows = await getDb()
    .select({
      id: user.id,
      name: user.name,
      wizard: user.wizardLevel,
      pirate: user.pirateLevel,
      alien: user.alienLevel,
    })
    .from(user)
    .where(
      or(
        gt(user.wizardLevel, 0),
        gt(user.pirateLevel, 0),
        gt(user.alienLevel, 0),
        unique.length > 0 ? inArray(user.id, unique) : undefined,
      ),
    );
  return rows.map(({ wizard, pirate, alien, ...rest }) => ({
    ...rest,
    levels: { wizard, pirate, alien },
  }));
}

/** Accounts that have claimed a paid ticket: the page's denominator. */
export async function claimedTicketHolderIds(): Promise<string[]> {
  const { tickets } = schema;
  const rows = await getDb()
    .select({ id: tickets.ownerUserId })
    .from(tickets)
    .where(
      and(
        visibleTickets,
        isNotNull(tickets.ownerUserId),
        eq(tickets.status, "paid"),
      ),
    )
    .groupBy(tickets.ownerUserId);
  return rows.flatMap((r) => (r.id ? [r.id] : []));
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `corepack pnpm exec vitest run src/lib/megagame-store.test.ts`
Expected: PASS (old tests included; nothing is removed yet).

Run: `corepack pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/megagame-store.ts src/lib/megagame-store.test.ts
git commit -m "feat(megagame): load the live event logs for the progress page"
```

---

## Milestone C: view helpers and the export route

### Task 6: Restore the dashboard view module, add formatting helpers and chart geometry

**Files:**

- Create (restored from 6487c9f): `src/app/backstage/megagame/dashboard/view.ts`
- Create (restored from 6487c9f): `src/app/backstage/megagame/dashboard/view.test.ts`
- Create: `src/app/backstage/megagame/dashboard/chart-geometry.ts`
- Create: `src/app/backstage/megagame/dashboard/chart-geometry.test.ts`

**Interfaces:**

- Consumes: `when` from `src/app/backstage/megagame/format.ts`; `CONFERENCE_DAYS`, `PACIFIC`, `fromPacificWall`, `pacificDayKey` from `src/lib/schedule.ts`; `BUCKET_MINUTES`, `bucketSeries`, `bucketStart`, `isBucketSize`, `BucketSize` from `src/lib/megagame-rules.ts`.
- Produces (view.ts): `DASHBOARD`, `RANGE_PRESETS`, `RangePreset`, `RANGE_LABELS`, `MAX_BUCKETS`, `DashboardParams`, `DashboardView` (without `cls`), `dashboardView(sp, now)`, `viewHref(view, change: { range?: RangePreset; bucket?: BucketSize })`, and new:
  - `EMPTY_RANGE: string`, the sentence the sections show when the range has no buckets
  - `formatDuration(ms: number | null): string`
  - `percent(fraction: number | null): string`
  - `decimal(n: number | null, digits?: number): string` (default 1 digit)
  - `bucketLabel(start: Date, size: BucketSize): string`
  - `endLabel(end: Date, size: BucketSize): string`
  - `dayLabel(key: string): string`
- Produces (chart-geometry.ts):
  - `type Point = { x: number; y: number }` (both in [0, 1])
  - `polylinePoints(points: readonly Point[], width: number, height: number): string`
  - `seriesPoints(values: readonly number[], max: number): Point[]`
  - `stackSegments(values: readonly number[], max: number, height: number): { y: number; height: number }[]`

`over-time/view.ts` has the same range math, but its `viewHref` builds Quest Board URLs, so the dashboard keeps its own copy ("Decisions" 13). Do not import from or change `over-time/view.ts`.

Formats:

- `formatDuration`: null gives "–"; round to whole minutes; under 60 minutes "45m"; under 24 hours "3h 05m"; otherwise "1d 4h" (minutes dropped).
- `percent`: null gives "–"; otherwise `Math.round(f * 100)` followed by "%".
- `decimal`: null gives "–"; otherwise `n.toFixed(digits)`.
- `bucketLabel`: for "1d", the Pacific day `Intl.DateTimeFormat("en-US", { timeZone: PACIFIC, weekday: "short", month: "short", day: "numeric" })` ("Fri, Nov 6"); otherwise `when(start)`.
- `endLabel`: for "1d", the day format applied to `end - 1 ms` followed by " (end)"; otherwise `when(end)`. These two match the old dashboard page (`git show 6487c9f:src/app/backstage/megagame/dashboard/page.tsx`, lines 69 to 82 and 598 to 599).
- `dayLabel`: a `CONFERENCE_DAYS` key gives `${name} ${dateLabel}` ("Friday Nov 6"); any other key is returned as is.
- `polylinePoints`: each point maps to `x * width, height - y * height`, each number rounded to 2 decimals with `Math.round(v * 100) / 100`, joined as "x,y" with spaces.
- `seriesPoints`: point i has `x = i / (n - 1)` (0.5 when n is 1) and `y = values[i] / max` (0 when max is 0).
- `stackSegments`: from the bottom; segment j has `height = values[j] / max * height` and `y` = the remaining top edge. `max` 0 gives zero heights at `y = height`.

- [ ] **Step 1: Restore the old test and write the new tests**

Run:

```bash
mkdir -p src/app/backstage/megagame/dashboard
git show 6487c9f:src/app/backstage/megagame/dashboard/view.test.ts > src/app/backstage/megagame/dashboard/view.test.ts
```

Then edit `view.test.ts` so that it reads as follows (the `cls` assertions are gone, the `viewHref` expectations have no `cls`, and there are new tests for an empty range and the formatters):

```ts
import { describe, expect, it } from "vitest";
import { when } from "../format";
import {
  MAX_BUCKETS,
  bucketLabel,
  dashboardView,
  dayLabel,
  decimal,
  endLabel,
  formatDuration,
  percent,
  viewHref,
} from "./view";

const now = new Date("2026-11-07T18:07:00.000Z"); // 10:07 AM Pacific, Saturday
const iso = (d: Date) => d.toISOString();

describe("dashboardView", () => {
  it("defaults to today in 30 minute buckets, from Pacific midnight", () => {
    const v = dashboardView({}, now);
    expect(v.preset).toBe("today");
    expect(v.size).toBe("30m");
    expect(iso(v.from)).toBe("2026-11-07T08:00:00.000Z");
    expect(iso(v.to)).toBe(iso(now));
    expect(v.buckets).toHaveLength(21);
    expect(iso(v.buckets.at(-1)!)).toBe("2026-11-07T18:00:00.000Z");
    expect(v.tooMany).toBe(false);
  });

  it("has no buckets for today at Pacific midnight, without flagging too many", () => {
    const v = dashboardView({}, new Date("2026-11-07T08:00:00.000Z"));
    expect(v.buckets).toEqual([]);
    expect(v.tooMany).toBe(false);
  });

  it("aligns the last 2 hours to the bucket containing its start", () => {
    const v = dashboardView({ range: "2h" }, now);
    expect(v.size).toBe("5m");
    expect(iso(v.from)).toBe("2026-11-07T16:05:00.000Z");
    expect(v.buckets).toHaveLength(25);
  });

  it("covers the three con days in Pacific time, ending at Monday midnight", () => {
    const after = new Date("2026-11-10T18:00:00.000Z");
    const v = dashboardView({ range: "con", bucket: "1d" }, after);
    expect(iso(v.from)).toBe("2026-11-06T08:00:00.000Z");
    expect(iso(v.to)).toBe("2026-11-09T08:00:00.000Z");
    expect(v.buckets.map(iso)).toEqual([
      "2026-11-06T08:00:00.000Z",
      "2026-11-07T08:00:00.000Z",
      "2026-11-08T08:00:00.000Z",
    ]);
  });

  it("ends the whole con range at now while the con is on", () => {
    const v = dashboardView({ range: "con", bucket: "1h" }, now);
    expect(iso(v.from)).toBe("2026-11-06T08:00:00.000Z");
    expect(iso(v.to)).toBe(iso(now));
    expect(iso(v.buckets.at(-1)!)).toBe("2026-11-07T18:00:00.000Z");
  });

  it("shows the whole con range before and after the con", () => {
    for (const at of ["2026-11-01T18:00:00.000Z", "2026-11-12T18:00:00.000Z"]) {
      const v = dashboardView({ range: "con", bucket: "1d" }, new Date(at));
      expect(iso(v.from)).toBe("2026-11-06T08:00:00.000Z");
      expect(iso(v.to)).toBe("2026-11-09T08:00:00.000Z");
    }
  });

  it("ignores an unknown range or bucket and a leftover class parameter", () => {
    const v = dashboardView({ range: "week", bucket: "2h", cls: "bard" }, now);
    expect([v.preset, v.size]).toEqual(["today", "30m"]);
    expect(v).not.toHaveProperty("cls");
  });

  it("takes the first value of a repeated parameter", () => {
    const v = dashboardView({ bucket: ["1h", "5m"] }, now);
    expect(v.size).toBe("1h");
  });

  it("flags a range with too many buckets and returns none", () => {
    const v = dashboardView({ range: "con", bucket: "5m" }, now);
    expect(v.tooMany).toBe(true);
    expect(v.buckets).toEqual([]);
    expect(MAX_BUCKETS).toBeLessThan(3 * 288);
  });
});

describe("viewHref", () => {
  it("keeps the range when the bucket changes", () => {
    const v = dashboardView({ range: "con", bucket: "3h" }, now);
    expect(viewHref(v, { bucket: "1h" })).toBe(
      "/backstage/megagame/dashboard?range=con&bucket=1h",
    );
  });

  it("drops the chosen bucket when the range changes, so the new range's default applies", () => {
    const v = dashboardView({ range: "con", bucket: "1h" }, now);
    expect(viewHref(v, { range: "2h" })).toBe(
      "/backstage/megagame/dashboard?range=2h",
    );
  });

  it("keeps both choices for the sign-in link", () => {
    const v = dashboardView({ range: "con", bucket: "1h" }, now);
    expect(viewHref(v, {})).toBe(
      "/backstage/megagame/dashboard?range=con&bucket=1h",
    );
  });
});

describe("formatters", () => {
  it("formats durations by size", () => {
    expect(formatDuration(null)).toBe("–");
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(45 * 60_000)).toBe("45m");
    expect(formatDuration((3 * 60 + 5) * 60_000)).toBe("3h 05m");
    expect(formatDuration(28 * 3_600_000)).toBe("1d 4h");
  });

  it("formats shares and decimals, with a dash for no value", () => {
    expect(percent(3 / 7)).toBe("43%");
    expect(percent(null)).toBe("–");
    expect(decimal(0.25, 2)).toBe("0.25");
    expect(decimal(1.5)).toBe("1.5");
    expect(decimal(null)).toBe("–");
  });

  it("labels day buckets by Pacific day and other buckets by time", () => {
    const fri = new Date("2026-11-06T08:00:00.000Z");
    expect(bucketLabel(fri, "1d")).toBe("Fri, Nov 6");
    expect(bucketLabel(fri, "1h")).toBe(when(fri));
    expect(endLabel(new Date("2026-11-07T08:00:00.000Z"), "1d")).toBe(
      "Fri, Nov 6 (end)",
    );
  });

  it("names con days", () => {
    expect(dayLabel("2026-11-07")).toBe("Saturday Nov 7");
    expect(dayLabel("2026-11-05")).toBe("2026-11-05");
  });
});
```

`chart-geometry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { polylinePoints, seriesPoints, stackSegments } from "./chart-geometry";

describe("polylinePoints", () => {
  it("maps unit points into the box with y pointing up", () => {
    expect(
      polylinePoints(
        [
          { x: 0, y: 0 },
          { x: 0.5, y: 0.25 },
          { x: 1, y: 1 },
        ],
        100,
        100,
      ),
    ).toBe("0,100 50,75 100,0");
  });

  it("rounds to two decimals", () => {
    expect(polylinePoints([{ x: 1 / 3, y: 0 }], 100, 10)).toBe("33.33,10");
  });
});

describe("seriesPoints", () => {
  it("spreads values evenly and scales by max", () => {
    expect(polylinePoints(seriesPoints([0, 0.5, 1], 1), 600, 120)).toBe(
      "0,120 300,60 600,0",
    );
  });

  it("centres a single value and treats max 0 as zero", () => {
    expect(seriesPoints([0.5], 1)).toEqual([{ x: 0.5, y: 0.5 }]);
    expect(seriesPoints([3], 0)).toEqual([{ x: 0.5, y: 0 }]);
  });
});

describe("stackSegments", () => {
  it("stacks from the bottom", () => {
    expect(stackSegments([2, 1, 0], 4, 100)).toEqual([
      { y: 50, height: 50 },
      { y: 25, height: 25 },
      { y: 25, height: 0 },
    ]);
  });

  it("draws nothing when max is 0", () => {
    expect(stackSegments([0, 0], 0, 100)).toEqual([
      { y: 100, height: 0 },
      { y: 100, height: 0 },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm exec vitest run src/app/backstage/megagame/dashboard/view.test.ts src/app/backstage/megagame/dashboard/chart-geometry.test.ts`
Expected: FAIL; `./view` and `./chart-geometry` do not exist.

- [ ] **Step 3: Restore view.ts and write the implementation**

Run:

```bash
git show 6487c9f:src/app/backstage/megagame/dashboard/view.ts > src/app/backstage/megagame/dashboard/view.ts
```

In the restored `view.ts`, line numbers as restored:

- Delete the `MEGAGAME_CLASSES`/`MegagameClass` import (line 1), the `cls` field of `DashboardView` (line 64), the `const cls = ...` line (75), `cls` in the returned object (line 87), the `cls?: MegagameClass` member of `viewHref`'s `change` parameter (line 92), and the `params.set("cls", ...)` line (100).
- Extend the existing `@/lib/schedule` import (lines 9 to 13) to `CONFERENCE_DAYS, PACIFIC, fromPacificWall, pacificDayKey`. Do not add a second import from `@/lib/schedule`.
- Add `import { when } from "../format";` with the other imports, then append:

```ts
export const EMPTY_RANGE =
  "This range has not started yet, so there are no buckets to show.";

const DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC,
  weekday: "short",
  month: "short",
  day: "numeric",
});

export function formatDuration(ms: number | null): string {
  if (ms === null) return "–";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export const percent = (f: number | null) =>
  f === null ? "–" : `${Math.round(f * 100)}%`;

export const decimal = (n: number | null, digits = 1) =>
  n === null ? "–" : n.toFixed(digits);

export const bucketLabel = (start: Date, size: BucketSize) =>
  size === "1d" ? DAY.format(start) : when(start);

export const endLabel = (end: Date, size: BucketSize) =>
  size === "1d"
    ? `${DAY.format(new Date(end.getTime() - 1))} (end)`
    : when(end);

export function dayLabel(key: string): string {
  const day = CONFERENCE_DAYS.find((d) => d.key === key);
  return day ? `${day.name} ${day.dateLabel}` : key;
}
```

`chart-geometry.ts`:

```ts
export type Point = { x: number; y: number };

const r2 = (v: number) => Math.round(v * 100) / 100;

export function polylinePoints(
  points: readonly Point[],
  width: number,
  height: number,
): string {
  return points
    .map((p) => `${r2(p.x * width)},${r2(height - p.y * height)}`)
    .join(" ");
}

export function seriesPoints(values: readonly number[], max: number): Point[] {
  const n = values.length;
  return values.map((v, i) => ({
    x: n === 1 ? 0.5 : i / (n - 1),
    y: max > 0 ? v / max : 0,
  }));
}

export function stackSegments(
  values: readonly number[],
  max: number,
  height: number,
): { y: number; height: number }[] {
  let top = height;
  return values.map((v) => {
    const h = max > 0 ? (v / max) * height : 0;
    top -= h;
    return { y: top, height: h };
  });
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `corepack pnpm exec vitest run src/app/backstage/megagame/dashboard/view.test.ts src/app/backstage/megagame/dashboard/chart-geometry.test.ts`
Expected: PASS.

Run: `corepack pnpm typecheck`
Expected: PASS. Nothing imports these modules yet, and the dashboard directory has no page yet, so nothing else is affected.

- [ ] **Step 5: Commit**

```bash
git add src/app/backstage/megagame/dashboard/view.ts src/app/backstage/megagame/dashboard/view.test.ts src/app/backstage/megagame/dashboard/chart-geometry.ts src/app/backstage/megagame/dashboard/chart-geometry.test.ts
git commit -m "feat(megagame): dashboard view helpers for the progress page"
```

### Task 7: Restore the CSV export route under megagame.manage

**Files:**

- Create (restored from 6487c9f): `src/app/backstage/megagame/dashboard/export/[table]/route.ts`
- Create (restored from 6487c9f): `src/app/backstage/megagame/dashboard/export/[table]/route.test.ts`

**Interfaces:**

- Consumes: `toolAccess` from `@/lib/admin-auth`; `toCsv`, `CsvCell` from `@/lib/csv`; `isEventTable` from `@/lib/megagame-rules`; `exportEventTable` from `@/lib/megagame-store`; `pacificDayKey` from `@/lib/schedule`. All of these exist on the branch today.
- Produces: `GET` at `/backstage/megagame/dashboard/export/[table]`, used by the page's export links in Task 8.

The exports name players by id, so the route takes the page's gate (spec 2). Everything else about the route is unchanged from 6487c9f.

- [ ] **Step 1: Restore the test and change it to the new gate**

Run:

```bash
mkdir -p "src/app/backstage/megagame/dashboard/export/[table]"
git show "6487c9f:src/app/backstage/megagame/dashboard/export/[table]/route.test.ts" > "src/app/backstage/megagame/dashboard/export/[table]/route.test.ts"
```

In the restored test, replace the first `it` block (lines 26 to 32) with these two:

```ts
it("is a 404 without megagame.manage and reads nothing", async () => {
  auth.toolAccess.mockResolvedValue(null);
  const res = await call("level_events");
  expect(auth.toolAccess).toHaveBeenCalledWith("megagame.manage");
  expect(res.status).toBe(404);
  expect(store.exportEventTable).not.toHaveBeenCalled();
});

it("is a 404 for a volunteer holding only megagame.verify", async () => {
  auth.toolAccess.mockImplementation(async (p: string) =>
    p === "megagame.verify" ? { name: "Vol", userId: "v1" } : null,
  );
  const res = await call("level_events");
  expect(res.status).toBe(404);
  expect(store.exportEventTable).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm exec vitest run "src/app/backstage/megagame/dashboard/export/[table]/route.test.ts"`
Expected: FAIL, `./route` does not exist.

- [ ] **Step 3: Restore the route and change the gate**

Run:

```bash
git show "6487c9f:src/app/backstage/megagame/dashboard/export/[table]/route.ts" > "src/app/backstage/megagame/dashboard/export/[table]/route.ts"
```

In the restored `route.ts`, change `toolAccess("megagame.verify")` to `toolAccess("megagame.manage")`. Change nothing else.

- [ ] **Step 4: Run the test and the typecheck**

Run: `corepack pnpm exec vitest run "src/app/backstage/megagame/dashboard/export/[table]/route.test.ts"`
Expected: PASS (four tests).

Run: `corepack pnpm typecheck`
Expected: PASS. `next typegen` generates the `RouteContext<"/backstage/megagame/dashboard/export/[table]">` type for the restored route.

- [ ] **Step 5: Commit**

```bash
git add "src/app/backstage/megagame/dashboard/export/[table]/route.ts" "src/app/backstage/megagame/dashboard/export/[table]/route.test.ts"
git commit -m "feat(megagame): restore the event CSV export under megagame.manage"
```

---

## Milestone D: the page

`page.tsx` is the only async component. `LevelGrid` and the section components are synchronous server components (no `"use client"`, no `async`, no `next/link`), so tests render them with `renderToStaticMarkup`. In `sections.test.ts`, keep all `import` statements together at the top of the file; each task below lists the imports it adds.

### Task 8: Page shell, gating, the four loads, level grid and export links

**Files:**

- Create (restored from 6487c9f, unchanged): `src/app/backstage/megagame/dashboard/AutoRefresh.tsx`
- Create: `src/app/backstage/megagame/dashboard/page.tsx`
- Create: `src/app/backstage/megagame/dashboard/page.test.ts`
- Create: `src/app/backstage/megagame/dashboard/styles.ts`
- Create: `src/app/backstage/megagame/dashboard/LevelGrid.tsx`
- Create: `src/app/backstage/megagame/dashboard/sections.test.ts`

**Interfaces:**

- Consumes: Task 4's `computeProgress`, `activeUserIds`; Task 5's four queries; Task 6's `dashboardView`, `viewHref`, `RANGE_LABELS`, `RANGE_PRESETS`, `DashboardView`, `percent`; Task 7's export route (linked, not imported); `toolAccess` from `@/lib/admin-auth`; `SignIn` from `../../SignIn`; `Section` from `../Section`; `EVENT_TABLES`, `BUCKET_SIZES` from `@/lib/megagame-rules`; `CLASS_LABELS`, `MAX_LEVEL`, `MEGAGAME_CLASSES` from `@/lib/megagame-levels`.
- Produces: `styles.ts` constants `TABLE`, `TH`, `THN`, `TD`, `TDN`, `BOX`, `NOTE`, `ALERT` used by every section; `LevelGrid({ grid, holders }: { grid: Record<MegagameClass, number[]>; holders: number })`; the default-exported async `DashboardPage`.

`styles.ts` (the class strings the Quest Board's `OverTime.tsx` and the old dashboard page use):

```ts
export const TABLE = "w-full border-collapse text-sm";
export const TH =
  "border-b border-line px-2 py-1.5 text-left font-semibold text-navy";
export const THN = `${TH} text-right`;
export const TD = "border-b border-line px-2 py-1.5 align-top";
export const TDN = `${TD} text-right tabular-nums`;
export const BOX = "overflow-x-auto rounded-xl border border-line bg-white p-2";
export const NOTE = "text-sm text-ink/60";
export const ALERT = "text-sm text-meeple";
```

There is no chart-hiding class: charts show on phones (spec 9).

- [ ] **Step 1: Write the failing tests**

`page.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, store } = vi.hoisted(() => ({
  auth: { toolAccess: vi.fn() },
  store: {
    liveCompletionLog: vi.fn(),
    liveLevelEventLog: vi.fn(),
    claimedTicketHolderIds: vi.fn(),
    progressPlayers: vi.fn(),
  },
}));
vi.mock("@/lib/admin-auth", () => auth);
vi.mock("@/lib/megagame-store", () => store);
vi.mock("next/server", () => ({ connection: vi.fn() }));

import SignIn from "../../SignIn";
import DashboardPage from "./page";

const props = (searchParams: Record<string, string>) =>
  ({
    params: Promise.resolve({}),
    searchParams: Promise.resolve(searchParams),
  }) as never;

const loadEmpty = () => {
  store.liveCompletionLog.mockResolvedValue([]);
  store.liveLevelEventLog.mockResolvedValue([]);
  store.claimedTicketHolderIds.mockResolvedValue([]);
  store.progressPlayers.mockResolvedValue([]);
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.toolAccess.mockResolvedValue(null);
});

const expectSignInOnly = (el: unknown, next: string) => {
  expect(el).toMatchObject({ type: SignIn, props: { next } });
  for (const fn of Object.values(store)) expect(fn).not.toHaveBeenCalled();
};

describe("dashboard page", () => {
  it("needs megagame.manage, keeps its choices through sign-in, and loads nothing without it", async () => {
    const el = await DashboardPage(props({ range: "con", bucket: "1h" }));
    expect(auth.toolAccess).toHaveBeenCalledWith("megagame.manage");
    expectSignInOnly(el, "/backstage/megagame/dashboard?range=con&bucket=1h");
  });

  it("is refused to a volunteer holding only megagame.verify", async () => {
    auth.toolAccess.mockImplementation(async (p: string) =>
      p === "megagame.verify" ? { name: "Vol", userId: "v1" } : null,
    );
    const el = await DashboardPage(props({}));
    expectSignInOnly(el, "/backstage/megagame/dashboard?range=today");
  });

  it("makes exactly four store requests: both logs, the holder ids, then the players behind them", async () => {
    auth.toolAccess.mockResolvedValue({ name: "Boss", userId: "m1" });
    loadEmpty();
    store.liveCompletionLog.mockResolvedValue([
      {
        userId: "u1",
        class: "wizard",
        confirmedAt: new Date("2026-11-06T18:00:00.000Z"),
      },
      {
        userId: null,
        class: null,
        confirmedAt: new Date("2026-11-06T19:00:00.000Z"),
      },
    ]);
    store.liveLevelEventLog.mockResolvedValue([
      {
        userId: "u2",
        class: "pirate",
        level: 1,
        source: "picker",
        awardedAt: new Date("2026-11-06T09:00:00.000Z"),
      },
    ]);
    await DashboardPage(props({ range: "con", bucket: "1d" }));
    expect(Object.keys(store).sort()).toEqual([
      "claimedTicketHolderIds",
      "liveCompletionLog",
      "liveLevelEventLog",
      "progressPlayers",
    ]);
    for (const fn of Object.values(store)) expect(fn).toHaveBeenCalledTimes(1);
    expect(store.progressPlayers).toHaveBeenCalledWith(["u1", "u2"]);
  });

  it("still renders when the range has too many buckets", async () => {
    auth.toolAccess.mockResolvedValue({ name: "Boss", userId: "m1" });
    loadEmpty();
    await expect(
      DashboardPage(props({ range: "con", bucket: "5m" })),
    ).resolves.toBeTruthy();
  });
});
```

The store mock lists only the four queries, so if `page.tsx` calls any other store function (for example `levelGrid`), Vitest throws because the mock defines no such export, which is how the test pins "four requests, and these four".

`sections.test.ts`:

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import LevelGrid from "./LevelGrid";

describe("LevelGrid", () => {
  it("shows players per level with percentages of ticket holders", () => {
    const html = renderToStaticMarkup(
      createElement(LevelGrid, {
        grid: {
          wizard: [0, 3, 1, 0, 0, 0],
          pirate: [0, 0, 0, 0, 0, 0],
          alien: [0, 2, 0, 0, 0, 0],
        },
        holders: 10,
      }),
    );
    expect(html).toContain("Wizard");
    expect(html).toContain("(30%)");
    expect(html).toContain("(40%)"); // wizard "In class" row: 4 of 10
    expect(html).toContain("of the 10 accounts");
  });

  it("shows a dash instead of a percentage with no holders", () => {
    const html = renderToStaticMarkup(
      createElement(LevelGrid, {
        grid: {
          wizard: [0, 1, 0, 0, 0, 0],
          pirate: [0, 0, 0, 0, 0, 0],
          alien: [0, 0, 0, 0, 0, 0],
        },
        holders: 0,
      }),
    );
    expect(html).toContain("(–)");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm exec vitest run src/app/backstage/megagame/dashboard/page.test.ts src/app/backstage/megagame/dashboard/sections.test.ts`
Expected: FAIL; `./page` and `./LevelGrid` do not exist.

- [ ] **Step 3: Write the implementation**

Restore the refresher unchanged:

```bash
git show 6487c9f:src/app/backstage/megagame/dashboard/AutoRefresh.tsx > src/app/backstage/megagame/dashboard/AutoRefresh.tsx
```

`LevelGrid.tsx` (the old dashboard page's "Levels" section, lines 169 to 217 at 6487c9f, as a component):

```tsx
import { BOX, NOTE, TABLE, TD, TDN, TH, THN } from "./styles";
import { percent } from "./view";
import {
  CLASS_LABELS,
  MAX_LEVEL,
  MEGAGAME_CLASSES,
  type MegagameClass,
} from "@/lib/megagame-levels";

const LEVELS = Array.from({ length: MAX_LEVEL }, (_, i) => i + 1);

export default function LevelGrid({
  grid,
  holders,
}: {
  grid: Record<MegagameClass, number[]>;
  holders: number;
}) {
  const share = (n: number) => percent(holders > 0 ? n / holders : null);
  return (
    <>
      <div className={BOX}>
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>Level</th>
              {MEGAGAME_CLASSES.map((c) => (
                <th key={c} className={THN}>
                  {CLASS_LABELS[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LEVELS.map((level) => (
              <tr key={level}>
                <td className={TD}>{level}</td>
                {MEGAGAME_CLASSES.map((c) => (
                  <td key={c} className={TDN}>
                    {grid[c][level]}{" "}
                    <span className="text-ink/50">
                      ({share(grid[c][level])})
                    </span>
                  </td>
                ))}
              </tr>
            ))}
            <tr className="font-semibold">
              <td className={TD}>In class</td>
              {MEGAGAME_CLASSES.map((c) => {
                const n = grid[c].reduce((a, b) => a + b, 0);
                return (
                  <td key={c} className={TDN}>
                    {n} <span className="text-ink/50">({share(n)})</span>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
      <p className={NOTE}>
        Players at each current level. Percentages are of the {holders} accounts
        that have claimed a paid ticket. There is no check-in data, so that is
        not a count of people at the con, and staff without a ticket can push a
        percentage up.
      </p>
    </>
  );
}
```

`page.tsx`:

```tsx
import Link from "next/link";
import { connection } from "next/server";
import SignIn from "../../SignIn";
import Section from "../Section";
import AutoRefresh from "./AutoRefresh";
import LevelGrid from "./LevelGrid";
import { NOTE } from "./styles";
import {
  RANGE_LABELS,
  RANGE_PRESETS,
  dashboardView,
  viewHref,
  type DashboardView,
} from "./view";
import { toolAccess } from "@/lib/admin-auth";
import { activeUserIds, computeProgress } from "@/lib/megagame-progress";
import { BUCKET_SIZES, EVENT_TABLES } from "@/lib/megagame-rules";
import {
  claimedTicketHolderIds,
  liveCompletionLog,
  liveLevelEventLog,
  progressPlayers,
} from "@/lib/megagame-store";
import { PACIFIC } from "@/lib/schedule";

const REFRESH_SECONDS = 60;
const TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC,
  hour: "numeric",
  minute: "2-digit",
});
const PICK =
  "rounded-full border px-3 py-1 text-sm whitespace-nowrap transition-colors";
const PICK_ON = `${PICK} border-navy bg-navy text-white`;
const PICK_OFF = `${PICK} border-line bg-white text-navy hover:border-navy`;

export default async function DashboardPage(
  props: PageProps<"/backstage/megagame/dashboard">,
) {
  await connection();
  const sp = await props.searchParams;
  const now = new Date();
  const view = dashboardView(sp, now);

  const access = await toolAccess("megagame.manage");
  if (!access) return <SignIn next={viewHref(view, {})} />;

  const [completions, levelEvents, holderIds] = await Promise.all([
    liveCompletionLog(),
    liveLevelEventLog(),
    claimedTicketHolderIds(),
  ]);
  const players = await progressPlayers(
    activeUserIds(completions, levelEvents),
  );
  const progress = computeProgress({
    completions,
    levelEvents,
    players,
    holderIds,
    buckets: view.buckets,
    size: view.size,
    to: view.to,
    now,
  });

  return (
    <div className="flex w-[min(64rem,calc(100vw-2rem))] flex-col gap-10 self-center">
      <AutoRefresh seconds={REFRESH_SECONDS} />
      <div className="flex flex-col gap-2">
        <h1 className="font-bebas text-3xl tracking-wide text-navy">
          Progress
        </h1>
        <p className={NOTE}>
          Updated {TIME.format(now)}. The page refreshes every minute. Voided
          records are left out. Deleted accounts count as one player.
        </p>
        <Pickers view={view} />
        <p className={NOTE}>
          The range and bucket apply to the over-time tables and charts. Every
          other figure covers all records so far.
        </p>
      </div>

      <Section title="Levels">
        <LevelGrid grid={progress.grid} holders={holderIds.length} />
      </Section>

      <Section title="Export">
        <ul className="flex flex-col gap-2">
          {EVENT_TABLES.map((t) => (
            <li key={t}>
              <a
                href={`/backstage/megagame/dashboard/export/${t}`}
                download
                className="font-semibold text-navy underline underline-offset-2 hover:text-meeple"
              >
                {t}.csv
              </a>
            </li>
          ))}
        </ul>
        <p className={NOTE}>
          Every row of each table, voided ones included. People and quests
          appear as ids.
        </p>
      </Section>
    </div>
  );
}

function Pickers({ view }: { view: DashboardView }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2" aria-label="Range">
        {RANGE_PRESETS.map((p) => (
          <Link
            key={p}
            href={viewHref(view, { range: p })}
            replace
            scroll={false}
            className={p === view.preset ? PICK_ON : PICK_OFF}
          >
            {RANGE_LABELS[p]}
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap gap-2" aria-label="Bucket size">
        {BUCKET_SIZES.map((s) => (
          <Link
            key={s}
            href={viewHref(view, { bucket: s })}
            replace
            scroll={false}
            className={s === view.size ? PICK_ON : PICK_OFF}
          >
            {s}
          </Link>
        ))}
      </div>
    </div>
  );
}
```

Tasks 9 to 12 insert their sections between "Levels" and "Export", in the order concentration, classes, transitions, cohorts.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `corepack pnpm exec vitest run src/app/backstage/megagame/dashboard src/app/backstage/megagame/pages.test.ts`
Expected: PASS.

Run: `corepack pnpm typecheck`
Expected: PASS. `next typegen` now generates `PageProps<"/backstage/megagame/dashboard">`. The old dashboard store queries are still exported and unused, which the typecheck allows.

- [ ] **Step 5: Commit**

```bash
git add src/app/backstage/megagame/dashboard/AutoRefresh.tsx src/app/backstage/megagame/dashboard/page.tsx src/app/backstage/megagame/dashboard/page.test.ts src/app/backstage/megagame/dashboard/styles.ts src/app/backstage/megagame/dashboard/LevelGrid.tsx src/app/backstage/megagame/dashboard/sections.test.ts
git commit -m "feat(megagame): progress page on the dashboard route with the level grid and exports"
```

### Task 9: Concentration section with Lorenz plot and line chart

**Files:**

- Create: `src/app/backstage/megagame/dashboard/charts.tsx` (`LorenzPlot`, `LineChart`)
- Create: `src/app/backstage/megagame/dashboard/ConcentrationSection.tsx`
- Modify: `src/app/backstage/megagame/dashboard/page.tsx`
- Modify: `src/app/backstage/megagame/dashboard/sections.test.ts`

**Interfaces:**

- Consumes: `Concentration`, `LorenzPoint` from `@/lib/megagame-progress`; `polylinePoints`, `seriesPoints` from `./chart-geometry`; `percent`, `decimal`, `endLabel`, `EMPTY_RANGE` from `./view`; `when`, `levelsText` from `../format`; `CLASS_COLORS`, `Legend` from `../over-time/charts` (read only; do not change that file); `CLASS_LABELS`, `MEGAGAME_CLASSES` from `@/lib/megagame-levels`; styles.
- Produces:
  - `LorenzPlot({ label, lines }: { label: string; lines: { name: string; color: string; points: LorenzPoint[] }[] })`
  - `LineChart({ label, series, first, last }: { label: string; series: { name: string; color: string; values: number[] }[]; first: string; last: string })` with a fixed y range of 0 to 1.
  - `ConcentrationSection({ data, ends, size, tooMany, rangeLabel }: { data: Concentration; ends: Date[]; size: BucketSize; tooMany: boolean; rangeLabel: string })`. `rangeLabel` is `RANGE_LABELS[view.preset]`, used in the too-many alert.

Content (spec 4):

1. Two headline blocks, "Quest completions" and "Volunteer level-ups", each a `<dl>` with: players (active or leveling), total, top 10%, top 20%, top 50% (via `percent`), Gini (via `decimal(g, 2)`). Below them a sentence: "The top 20% of active players hold {percent(top20)} of completions."
2. Lorenz: `LorenzPlot` with label "Lorenz curve of completions per player, overall and by class", inside a `figure`, lines for overall (color `#173059`, name "All quests") and each class (`CLASS_COLORS`), plus `Legend`. Table fallback: rows "All quests" and each class label, columns Players, Completions, Top 20%, Gini, from `data.completions` and `data.byClass`. The Lorenz plot does not depend on the range, so it shows even when the range is empty.
3. Over time, in this order of cases:
   - `tooMany`: `<p role="alert" className={ALERT}>{rangeLabel} in {size} buckets is too many rows to show. Pick a bigger bucket.</p>` and nothing else for this part.
   - `ends.length === 0`: `<p className={NOTE}>{EMPTY_RANGE}</p>` and nothing else for this part: no chart, no endpoint labels, no table.
   - otherwise: `LineChart` with label "Top 20% share and Gini of completions as of the end of each bucket", series `top20` (color `#173059`, name "Top 20% share") and `gini` (color `#C2410C`, name "Gini") over `data.series`, `first = endLabel(ends[0], size)`, `last = endLabel(ends.at(-1)!, size)`, then a table with columns As of, Players, Completions, Top 20%, Gini.
4. Most active: table with columns Player, Levels (`levelsText(row.levels)`), Completions, Wizard, Pirate, Alien, Any class, Level-ups, First, Last (`when(...)`). Name is `row.name ?? "Deleted account"`. An empty list shows "No completions yet." in `NOTE`.

Add `ALERT` to the imports from `./styles`. No element in this section uses `hidden sm:block` or any other class that hides it on phones.

`charts.tsx`:

```tsx
import { polylinePoints, seriesPoints } from "./chart-geometry";
import type { LorenzPoint } from "@/lib/megagame-progress";

export function LorenzPlot({
  label,
  lines,
}: {
  label: string;
  lines: { name: string; color: string; points: LorenzPoint[] }[];
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      role="img"
      aria-label={label}
      className="aspect-square w-64 max-w-full border-b border-l border-ink/30"
    >
      <line
        x1="0"
        y1="100"
        x2="100"
        y2="0"
        stroke="#173059"
        strokeOpacity="0.25"
        strokeDasharray="2 2"
        vectorEffect="non-scaling-stroke"
      />
      {lines
        .filter((l) => l.points.length > 0)
        .map((l) => (
          <polyline
            key={l.name}
            points={polylinePoints(l.points, 100, 100)}
            fill="none"
            stroke={l.color}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          >
            <title>{l.name}</title>
          </polyline>
        ))}
    </svg>
  );
}

const W = 600;
const H = 120;

/** Lines on a fixed 0 to 1 scale; callers render it only when there is at least one point. */
export function LineChart({
  label,
  series,
  first,
  last,
}: {
  label: string;
  series: { name: string; color: string; values: number[] }[];
  first: string;
  last: string;
}) {
  return (
    <figure className="flex flex-col gap-1">
      <div className="flex gap-2">
        <span className="flex w-10 shrink-0 flex-col justify-between text-right text-xs text-ink/50">
          <span>100%</span>
          <span>0%</span>
        </span>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={label}
          className="h-32 w-full border-b border-l border-ink/30"
        >
          {series.map((s) => (
            <polyline
              key={s.name}
              points={polylinePoints(seriesPoints(s.values, 1), W, H)}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            >
              <title>{s.name}</title>
            </polyline>
          ))}
        </svg>
      </div>
      <figcaption className="ml-12 flex justify-between text-xs text-ink/50">
        <span>{first}</span>
        {last !== first && <span>{last}</span>}
      </figcaption>
    </figure>
  );
}
```

- [ ] **Step 1: Write the failing tests** (add the imports at the top of `sections.test.ts` and the rest at the end)

```ts
import ConcentrationSection from "./ConcentrationSection";
import { DELETED_PLAYER, type Concentration } from "@/lib/megagame-progress";
import { NO_LEVELS } from "@/lib/megagame-levels";
```

```ts
const summary = (
  players: number,
  total: number,
  top20: number,
  gini: number,
) => ({
  players,
  total,
  top10: top20,
  top20,
  top50: top20,
  gini,
});
const concentrationData: Concentration = {
  completions: summary(4, 7, 3 / 7, 0.25),
  byClass: {
    wizard: summary(3, 4, 0.5, 0.2),
    pirate: summary(2, 2, 0.5, 0),
    alien: summary(0, 0, 0, 0),
  },
  levelUps: summary(2, 3, 2 / 3, 1 / 6),
  lorenz: {
    overall: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
    byClass: { wizard: [], pirate: [], alien: [] },
  },
  series: [
    {
      end: new Date("2026-11-07T08:00:00.000Z"),
      players: 2,
      completions: 3,
      top20: 2 / 3,
      gini: 1 / 6,
    },
  ],
  mostActive: [
    {
      key: DELETED_PLAYER,
      userId: null,
      name: null,
      levels: NO_LEVELS,
      completions: 2,
      byClass: { wizard: 1, pirate: 1, alien: 0 },
      anyClass: 0,
      levelUps: 0,
      firstActivity: new Date("2026-11-06T22:00:00.000Z"),
      lastActivity: new Date("2026-11-06T23:00:00.000Z"),
    },
  ],
};
const renderConcentration = (
  tooMany: boolean,
  ends = [new Date("2026-11-07T08:00:00.000Z")],
  data = concentrationData,
) =>
  renderToStaticMarkup(
    createElement(ConcentrationSection, {
      data,
      ends,
      size: "1d",
      tooMany,
      rangeLabel: "Whole con",
    }),
  );

describe("ConcentrationSection", () => {
  it("shows the headline shares and Gini", () => {
    const html = renderConcentration(false);
    expect(html).toContain("43%");
    expect(html).toContain("0.25");
    expect(html).toContain("67%"); // level-ups top 20%
  });

  it("labels the Lorenz plot and the series chart and keeps their tables", () => {
    const html = renderConcentration(false);
    expect(html).toMatch(/aria-label="[^"]*Lorenz/);
    expect(html).toMatch(/aria-label="Top 20% share and Gini/);
    expect(html).toContain("Fri, Nov 6 (end)");
    expect(html).toContain("0.17");
  });

  it("does not hide the charts on phones", () => {
    expect(renderConcentration(false)).not.toContain("hidden sm:block");
  });

  it("names deleted accounts in the most-active table", () => {
    expect(renderConcentration(false)).toContain("Deleted account");
  });

  it("replaces the series with the too-many-buckets alert", () => {
    const html = renderConcentration(true, []);
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("Fri, Nov 6 (end)");
  });

  it("shows an empty state with no series chart or end labels when the range has no buckets", () => {
    const html = renderConcentration(false, [], {
      ...concentrationData,
      series: [],
    });
    expect(html).toContain("This range has not started yet");
    expect(html).not.toMatch(/aria-label="Top 20% share and Gini/);
    expect(html).not.toContain("(end)");
    expect(html).not.toContain('role="alert"');
    expect(html).toMatch(/aria-label="[^"]*Lorenz/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm exec vitest run src/app/backstage/megagame/dashboard/sections.test.ts`
Expected: FAIL, `./ConcentrationSection` does not exist.

- [ ] **Step 3: Write the implementation** as specified above, then in `page.tsx` add `import ConcentrationSection from "./ConcentrationSection";` and render, after the "Levels" section:

```tsx
<Section title="Concentration">
  <ConcentrationSection
    data={progress.concentration}
    ends={progress.ends}
    size={view.size}
    tooMany={view.tooMany}
    rangeLabel={RANGE_LABELS[view.preset]}
  />
</Section>
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `corepack pnpm exec vitest run src/app/backstage/megagame/dashboard`
Expected: PASS.

Run: `corepack pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/backstage/megagame/dashboard/charts.tsx src/app/backstage/megagame/dashboard/ConcentrationSection.tsx src/app/backstage/megagame/dashboard/page.tsx src/app/backstage/megagame/dashboard/sections.test.ts
git commit -m "feat(megagame): concentration section with Lorenz and series charts"
```

### Task 10: Classes section with cumulative level bars

**Files:**

- Create: `src/app/backstage/megagame/dashboard/ClassesSection.tsx`
- Modify: `src/app/backstage/megagame/dashboard/charts.tsx` (add `ClassLevelBars`)
- Modify: `src/app/backstage/megagame/dashboard/page.tsx`
- Modify: `src/app/backstage/megagame/dashboard/sections.test.ts`

**Interfaces:**

- Consumes: `ClassTable` from `@/lib/megagame-progress`; `stackSegments` from `./chart-geometry`; `bucketLabel`, `endLabel`, `percent`, `EMPTY_RANGE` from `./view`; `CLASS_LABELS`, `MEGAGAME_CLASSES`, `MAX_LEVEL`, `MegagameClass` from `@/lib/megagame-levels`; `CLASS_COLORS`, `Legend` from `../over-time/charts`; styles including `ALERT`.
- Produces:
  - `ClassLevelBars({ label, rows }: { label: string; rows: { label: string; byClass: Record<MegagameClass, number[]> }[] })` in `dashboard/charts.tsx`: a 600 by 120 viewBox with `preserveAspectRatio="none"`, `role="img"`, `aria-label={label}` and class `h-32 w-full`; per row a slot of width `600 / rows.length` holding three bars (wizard, pirate, alien), each stacked with `stackSegments(byClass[c].slice(1), max, 120)` from level 1 at the bottom to level 5, segment fill `CLASS_COLORS[c]` with `fillOpacity` `0.3 + 0.7 * (level / MAX_LEVEL)`; `max` is the largest in-class total across rows and classes (at least 1); each bar has a `<title>` "Wizard: 1: 3, 2: 1, 3: 0, 4: 0, 5: 0" for hover. Callers render it only when `rows.length > 0`.
  - `ClassesSection({ table, cumulative, ends, size, tooMany, rangeLabel }: { table: ClassTable; cumulative: Record<MegagameClass, number[]>[]; ends: Date[]; size: BucketSize; tooMany: boolean; rangeLabel: string })`.

Content (spec 5):

1. If `tooMany`, the same alert as Task 9 and nothing else. If `ends.length === 0`, `<p className={NOTE}>{EMPTY_RANGE}</p>` and nothing else: no table, no chart, no endpoint labels.
2. Per-bucket table: header row 1 "Bucket start" (rowSpan 2), one `colSpan={4}` group per class with the class label, "Any class" (rowSpan 2). Header row 2 per class: Completions, Level-ups, Active, "% of members". Body: one row per `table.rows` entry labelled `bucketLabel(row.start, size)`, cells from `byClass[c]` with `percent(memberShare)`. A bold "Total" row from `table.totals`. Under the table, a `NOTE`: "Active means a completion of one of the class's quests or a volunteer level-up in the class; faction picks do not count. Members are players at level 1 or higher in the class now: wizard {n}, pirate {n}, alien {n}. Any-class quests count only in their own column."
3. Cumulative levels: `Legend` of the three classes, `ClassLevelBars` in a `figure` (shown on phones too) with label "Players at each level by class as of the end of each bucket", rows labelled `endLabel(ends[i], size)`, with the first and last labels in a `figcaption` under it. Table fallback: column "As of", then per class a cell showing the five level counts as "3 / 1 / 0 / 0 / 0" and an "In class" total per class. Then this `NOTE`, adapted from the old dashboard page (lines 467 to 474 at 6487c9f) to cover all three classes: "Players at each level as of the end of each bucket, counted from the level-up log rather than the current level columns, so the last row can differ slightly from the level grid at the top. Undone level-ups are left out of every row, so a player who switched class through the picker shows only in the new class, even in rows from before the switch. Faction picks count as level 1 from the time of the pick."

- [ ] **Step 1: Write the failing tests** (imports at the top, the rest at the end)

```ts
import ClassesSection from "./ClassesSection";
import type { ClassTable } from "@/lib/megagame-progress";
```

```ts
const cell = (
  completions: number,
  levelUps: number,
  activePlayers: number,
  memberShare: number | null,
) => ({
  completions,
  levelUps,
  activePlayers,
  memberShare,
});
const classData: ClassTable = {
  members: { wizard: 2, pirate: 1, alien: 0 },
  rows: [
    {
      start: new Date("2026-11-06T08:00:00.000Z"),
      end: new Date("2026-11-07T08:00:00.000Z"),
      byClass: {
        wizard: cell(1, 1, 1, 0.5),
        pirate: cell(1, 0, 1, 1),
        alien: cell(0, 0, 0, null),
      },
      anyClass: 4,
    },
  ],
  totals: {
    byClass: {
      wizard: cell(1, 1, 1, 0.5),
      pirate: cell(1, 0, 1, 1),
      alien: cell(0, 0, 0, null),
    },
    anyClass: 4,
  },
};
const emptyClassData: ClassTable = {
  members: classData.members,
  rows: [],
  totals: {
    byClass: {
      wizard: cell(0, 0, 0, 0),
      pirate: cell(0, 0, 0, 0),
      alien: cell(0, 0, 0, null),
    },
    anyClass: 0,
  },
};
const renderClasses = (tooMany: boolean) =>
  renderToStaticMarkup(
    createElement(ClassesSection, {
      table: classData,
      cumulative: [
        {
          wizard: [0, 3, 1, 0, 0, 0],
          pirate: [0, 1, 0, 0, 0, 0],
          alien: [0, 0, 0, 0, 0, 0],
        },
      ],
      ends: [new Date("2026-11-07T08:00:00.000Z")],
      size: "1d",
      tooMany,
      rangeLabel: "Whole con",
    }),
  );

describe("ClassesSection", () => {
  it("shows a row per bucket and a total row", () => {
    const html = renderClasses(false);
    expect(html).toContain("Fri, Nov 6");
    expect(html).toContain("Total");
    expect(html).toContain("50%"); // wizard: 1 active of 2 members
    expect(html).toContain("100%"); // pirate: 1 active of 1 member
    expect(html).toContain("% of members");
    expect(html).toContain("faction picks do not count");
  });

  it("draws the cumulative bars with a label and a table fallback, also on phones", () => {
    const html = renderClasses(false);
    expect(html).toMatch(/aria-label="Players at each level by class/);
    expect(html).toContain("3 / 1 / 0 / 0 / 0");
    expect(html).not.toContain("hidden sm:block");
  });

  it("shows only the alert when there are too many buckets", () => {
    const html = renderClasses(true);
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("Total");
  });

  it("shows an empty state with no table, bars or end labels when the range has no buckets", () => {
    const html = renderToStaticMarkup(
      createElement(ClassesSection, {
        table: emptyClassData,
        cumulative: [],
        ends: [],
        size: "1d",
        tooMany: false,
        rangeLabel: "Today",
      }),
    );
    expect(html).toContain("This range has not started yet");
    expect(html).not.toMatch(/aria-label="Players at each level by class/);
    expect(html).not.toContain("Total");
    expect(html).not.toContain("(end)");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm exec vitest run src/app/backstage/megagame/dashboard/sections.test.ts`
Expected: FAIL, `./ClassesSection` does not exist.

- [ ] **Step 3: Write the implementation** as specified, and in `page.tsx` import it and render, after the concentration section:

```tsx
<Section title="Classes">
  <ClassesSection
    table={progress.classes}
    cumulative={progress.cumulative}
    ends={progress.ends}
    size={view.size}
    tooMany={view.tooMany}
    rangeLabel={RANGE_LABELS[view.preset]}
  />
</Section>
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `corepack pnpm exec vitest run src/app/backstage/megagame/dashboard`
Expected: PASS.

Run: `corepack pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/backstage/megagame/dashboard/ClassesSection.tsx src/app/backstage/megagame/dashboard/charts.tsx src/app/backstage/megagame/dashboard/page.tsx src/app/backstage/megagame/dashboard/sections.test.ts
git commit -m "feat(megagame): classes side by side with cumulative level bars"
```

---

### Task 11: Transitions section

**Files:**

- Create: `src/app/backstage/megagame/dashboard/TransitionsSection.tsx`
- Modify: `src/app/backstage/megagame/dashboard/page.tsx`
- Modify: `src/app/backstage/megagame/dashboard/sections.test.ts`

**Interfaces:**

- Consumes: `Transitions` from `@/lib/megagame-progress`; `formatDuration` from `./view`; `CLASS_LABELS`; styles.
- Produces: `TransitionsSection({ data }: { data: Transitions })`, synchronous.

Content (spec 6):

1. Table "Level-ups": columns Class, Step ("1 → 2"), Made, Skipped past, 25th percentile, Median, 75th percentile. Class label shown on the first row of each class only (rowSpan 4 or blank cells; either is fine). Durations through `formatDuration`.
2. Table "Time at the current level": columns Class, Level, Players, With a level-up record, Median time at level.
3. `NOTE`: "Times count from the later of the earlier level-up and the start of the con (midnight Pacific, Friday Nov 6), so time at level 1 means time at the con before the first level-up. Skipped past counts players who went from this level straight to a higher one than the next; they are left out of the times. Players whose current level has no level-up record are counted but left out of the median. Deleted accounts are left out."

- [ ] **Step 1: Write the failing tests** (imports at the top, the rest at the end)

```ts
import TransitionsSection from "./TransitionsSection";
import type { Transitions } from "@/lib/megagame-progress";
```

```ts
const HOUR = 3_600_000;
const transitionData: Transitions = {
  rows: [
    {
      class: "wizard",
      from: 1,
      to: 2,
      made: 3,
      skipped: 1,
      q25: 3 * HOUR,
      median: 4 * HOUR,
      q75: 5 * HOUR,
    },
    {
      class: "wizard",
      from: 2,
      to: 3,
      made: 0,
      skipped: 0,
      q25: null,
      median: null,
      q75: null,
    },
  ],
  current: [
    {
      class: "wizard",
      level: 2,
      players: 3,
      withEvent: 2,
      medianSince: 5.5 * HOUR,
    },
  ],
};

describe("TransitionsSection", () => {
  it("shows counts, skips and durations, with a dash where nobody made it", () => {
    const html = renderToStaticMarkup(
      createElement(TransitionsSection, { data: transitionData }),
    );
    expect(html).toContain("1 → 2");
    expect(html).toContain("3h 00m");
    expect(html).toContain("4h 00m");
    expect(html).toContain("5h 30m");
    expect(html).toContain("–");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm exec vitest run src/app/backstage/megagame/dashboard/sections.test.ts`
Expected: FAIL, `./TransitionsSection` does not exist.

- [ ] **Step 3: Write the implementation** as specified, and in `page.tsx` import it and render `<Section title="Level transitions"><TransitionsSection data={progress.transitions} /></Section>` after the classes section.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `corepack pnpm exec vitest run src/app/backstage/megagame/dashboard`
Expected: PASS.

Run: `corepack pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/backstage/megagame/dashboard/TransitionsSection.tsx src/app/backstage/megagame/dashboard/page.tsx src/app/backstage/megagame/dashboard/sections.test.ts
git commit -m "feat(megagame): level transition section"
```

### Task 12: Cohorts section

**Files:**

- Create: `src/app/backstage/megagame/dashboard/CohortsSection.tsx`
- Modify: `src/app/backstage/megagame/dashboard/page.tsx`
- Modify: `src/app/backstage/megagame/dashboard/sections.test.ts`

**Interfaces:**

- Consumes: `CohortTable` from `@/lib/megagame-progress`; `dayLabel`, `percent`, `decimal` from `./view`; styles.
- Produces: `CohortsSection({ data }: { data: CohortTable })`, synchronous.

Content (spec 7):

1. Table: columns First active, Players, Completions per player (mean), (median), Level-ups per player (mean), Reached level 2+, then one column per `data.days` entry headed "Active {dayLabel(day)}". Cells via `decimal` and `percent`; null retention cells show "–".
2. Below: "{notYetActive} of {holders} claimed-ticket holders have no completions or level-ups yet ({percent(notYetActiveShare)})."
3. `NOTE`: "A player's cohort is the Pacific day of their first completion or volunteer level-up; faction picks do not count. Cohorts cover the whole con whatever range is picked above. Deleted accounts are left out."

- [ ] **Step 1: Write the failing tests** (imports at the top, the rest at the end)

```ts
import CohortsSection from "./CohortsSection";
import type { CohortTable } from "@/lib/megagame-progress";
```

```ts
const cohortData: CohortTable = {
  days: ["2026-11-06", "2026-11-07", "2026-11-08"],
  rows: [
    {
      day: "2026-11-06",
      size: 2,
      completionsMean: 1,
      completionsMedian: 1,
      levelUpsMean: 0.5,
      reachedLevel2Share: 1,
      retention: [null, 0.5, 0],
    },
  ],
  holders: 4,
  notYetActive: 2,
  notYetActiveShare: 0.5,
};

describe("CohortsSection", () => {
  it("shows each cohort with retention on later days only", () => {
    const html = renderToStaticMarkup(
      createElement(CohortsSection, { data: cohortData }),
    );
    expect(html).toContain("Friday Nov 6");
    expect(html).toContain("Active Saturday Nov 7");
    expect(html).toContain("50%");
    expect(html).toContain("0.5");
    expect(html).toContain("2 of 4 claimed-ticket holders");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm exec vitest run src/app/backstage/megagame/dashboard/sections.test.ts`
Expected: FAIL, `./CohortsSection` does not exist.

- [ ] **Step 3: Write the implementation** as specified, and in `page.tsx` import it and render `<Section title="Cohorts"><CohortsSection data={progress.cohorts} /></Section>` after the transitions section and before Export.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `corepack pnpm exec vitest run src/app/backstage/megagame/dashboard`
Expected: PASS.

Run: `corepack pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/backstage/megagame/dashboard/CohortsSection.tsx src/app/backstage/megagame/dashboard/page.tsx src/app/backstage/megagame/dashboard/sections.test.ts
git commit -m "feat(megagame): join cohort section"
```

---

## Milestone E: removal

### Task 13: Remove the store queries nothing calls

**Files:**

- Modify: `src/lib/megagame-store.ts`
- Modify: `src/lib/megagame-store.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: nothing new; removes symbols.

The list below was computed with grep on 2026-11-03, after the rebase onto 5be83f7 ("Decisions" 12). Step 1 checks it again before anything is deleted.

- [ ] **Step 1: Confirm nothing else uses the code to be removed**

Run:

```bash
for f in levelGrid claimedTicketHolderCount questCompletionCounts QuestCount distinctCompletingPlayers completionsByVolunteer VolunteerCount liveLevelEventsBefore recentOverrides OverrideRow; do echo "== $f"; grep -rnw "$f" src scripts | grep -v -e "src/lib/megagame-store.ts" -e "src/lib/megagame-store.test.ts"; done
```

Expected: no lines under any heading. If something shows up, keep that symbol and its test, remove the rest, and say which one was kept and why in the commit message.

Also confirm the kept queries are still called, so the list is not short of anything:

```bash
for f in completionSeries levelEventSeries recentVoids exportEventTable; do echo "== $f"; grep -rlw "$f" src | grep -v -e "src/lib/megagame-store.ts" -e "src/lib/megagame-store.test.ts"; done
```

Expected: `data.ts` under the first three (and `data.test.ts` if it mocks them), the export route under `exportEventTable`.

- [ ] **Step 2: Remove the code and its tests**

From `megagame-store.ts`, find each by name in the Dashboard section and delete it with its doc comment: `levelGrid`, `claimedTicketHolderCount`, `QuestCount` and `questCompletionCounts`, `distinctCompletingPlayers`, `VolunteerCount` and `completionsByVolunteer`, `liveLevelEventsBefore`, `OverrideRow` and `recentOverrides`. Keep `dateBin`, `CompletionBucket`, `completionSeries`, `LevelEventBucket`, `levelEventSeries`, `VoidRow`, `recentVoids`, `exportEventTable`, `listQuests`, `importQuests` and `levelEventsFor`.

Then remove the imports that are now unused. From a grep on 2026-11-03 these are `MEGAGAME_CLASSES` (only `levelGrid` used it) and `type DatedLevelEvent` (only `liveLevelEventsBefore` used it). `gt` stays (Task 5's `progressPlayers` uses it), as do `alias`, `asc`, `desc`, `isNotNull` and `MAX_LEVEL`. Let `corepack pnpm lint` and `corepack pnpm typecheck` confirm.

From `megagame-store.test.ts`: remove `claimedTicketHolderCount`, `completionsByVolunteer`, `distinctCompletingPlayers`, `levelGrid`, `liveLevelEventsBefore`, `questCompletionCounts` and `recentOverrides` from the import list, and delete their `describe` blocks (`levelGrid`, `claimedTicketHolderCount`, `questCompletionCounts`, `distinctCompletingPlayers`, `completionsByVolunteer`, `liveLevelEventsBefore`, `recentOverrides`). Keep the `completionSeries`, `levelEventSeries`, `recentVoids` and `exportEventTable` blocks.

- [ ] **Step 3: Run the affected tests, lint and typecheck**

Run: `corepack pnpm exec vitest run src/lib/megagame-store.test.ts src/app/backstage/megagame`
Expected: PASS.

Run: `corepack pnpm lint`
Expected: PASS.

Run: `corepack pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/megagame-store.ts src/lib/megagame-store.test.ts
git commit -m "refactor(megagame): drop the store queries the old dashboard left behind"
```

---

## Milestone F: link and permission text

### Task 14: Manager-only "Dashboard" link on the Quest Board

**Files:**

- Modify: `src/app/backstage/megagame/page.tsx`
- Modify: `src/app/backstage/megagame/pages.test.ts`

**Interfaces:**

- Consumes: the existing `viewer.manager` value in `QuestBoard` (`page.tsx`, from `toolAccess("megagame.manage")`).
- Produces: nothing new.

The layout (`layout.tsx`) is synchronous, has no nav and does not resolve access, while `page.tsx` already knows whether the viewer is a manager, so the link goes in `page.tsx` ("Decisions" 14). Do not change `layout.tsx`.

- [ ] **Step 1: Write the failing tests**

In `pages.test.ts`, the existing test "renders the four sections in order with the viewer's undo rights" maps every child of the returned fragment to a component name. With the link added, a non-manager's first child is `false`. Change its first two lines to filter that out:

```ts
const el = (await QuestBoard(props({ quest: "A2C4EF" }))) as {
  props: { children: unknown[] };
};
const sections = el.props.children.filter(Boolean) as {
  type: unknown;
  props: Record<string, unknown>;
}[];
```

Then add, after the `describe("Quest Board for a volunteer", ...)` block:

```ts
const hrefs = (node: unknown): string[] => {
  if (Array.isArray(node)) return node.flatMap(hrefs);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const props = (node as { props: Record<string, unknown> }).props;
  return [
    ...(typeof props.href === "string" ? [props.href] : []),
    ...hrefs(props.children),
  ];
};

describe("Quest Board dashboard link", () => {
  it("is hidden from a volunteer without megagame.manage", async () => {
    auth.toolAccess.mockImplementation(async (p: string) =>
      p === "megagame.verify" ? { name: "Vol", userId: "v1" } : null,
    );
    const el = await QuestBoard(props({}));
    expect(hrefs(el)).not.toContain("/backstage/megagame/dashboard");
  });

  it("is shown to a manager", async () => {
    auth.toolAccess.mockResolvedValue({ name: "Boss", userId: "m1" });
    const el = await QuestBoard(props({}));
    expect(hrefs(el)).toContain("/backstage/megagame/dashboard");
  });
});
```

`hrefs` walks only element props, so it does not run the section components.

- [ ] **Step 2: Run the tests to verify the new one fails**

Run: `corepack pnpm exec vitest run src/app/backstage/megagame/pages.test.ts`
Expected: FAIL on "is shown to a manager"; the other tests pass.

- [ ] **Step 3: Implement**

In `page.tsx`, add `import Link from "next/link";` and make the returned fragment start with:

```tsx
{
  viewer.manager && (
    <p className="text-right text-sm">
      <Link
        href="/backstage/megagame/dashboard"
        className="text-ink/60 underline underline-offset-2 hover:text-meeple"
      >
        Dashboard
      </Link>
    </p>
  );
}
```

followed by the four sections unchanged.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `corepack pnpm exec vitest run src/app/backstage/megagame/pages.test.ts`
Expected: PASS.

Run: `corepack pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/backstage/megagame/page.tsx src/app/backstage/megagame/pages.test.ts
git commit -m "feat(megagame): link managers to the progress dashboard from the Quest Board"
```

### Task 15: Permission descriptions

**Files:**

- Modify: `src/lib/permissions.ts` (the `megagame.verify` and `megagame.manage` entries, lines 200 to 216)

This is a text-only change; no test pins the descriptions.

- [ ] **Step 1: Edit the two descriptions**

`megagame.verify` becomes "Record quest completions and level-ups at /backstage/megagame." `megagame.manage` becomes "Import and edit quests, change level requirements, void anyone's records, and read the progress dashboard at /backstage/megagame/dashboard."

- [ ] **Step 2: Run the permission tests and the typecheck**

Run: `corepack pnpm exec vitest run src/lib/permissions.test.ts`
Expected: PASS.

Run: `corepack pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/permissions.ts
git commit -m "docs(megagame): say that managers read the progress dashboard in the permission text"
```

---

## Milestone G: verification, PR and preview

### Task 16: Full checks, push, draft PR

**Files:** none unless a check fails.

- [ ] **Step 1: Run every check**

Run, one at a time:

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm vitest run
```

Expected: all PASS. (`corepack pnpm typecheck` is the repo's script for `next typegen && tsc --noEmit`.) If a check fails, fix it in a commit of its own and rerun all three.

- [ ] **Step 2: Check the pure module's imports**

Run: `grep -nE "@/db|drizzle-orm|server-only|megagame-store" src/lib/megagame-progress.ts`
Expected: no output.

- [ ] **Step 3: Check the base**

Run: `git log --oneline 5be83f7..megagame-volunteer`
If this lists commits (on 2026-11-03 it listed 5323bb4 and 3545912, two fixes pushed to `fork/megagame-volunteer` after this branch was rebased), rebase onto the current volunteer branch with `git rebase megagame-volunteer` and rerun Step 1. If the rebase conflicts, run `git rebase --abort`, stop, and report the conflicting files.

- [ ] **Step 4: Push to the fork**

Run: `git push -u fork megagame-dashboard`
If the push is refused with an access-rights or "repository exists" error, stop and report it. That error comes from the SSH keyring prompt, not from missing permissions; the user will unlock the keyring and retry.

- [ ] **Step 5: Open the draft PR**

Write the description to a file in the session's scratchpad directory, with each paragraph and list item on one line (no hard wraps), then run:

```bash
gh pr create --draft --repo tradingbootcamp/metagame-2026 --base main --head jkopczyn:megagame-dashboard --title "feat(megagame): progress dashboard for the design team" --body-file <scratchpad>/pr-body.md
```

The description says, in full sentences:

- This PR stacks on https://github.com/tradingbootcamp/metagame-2026/pull/416 (`megagame-volunteer`) and should be merged after it. Its own commits are the ones listed below; everything before them belongs to #416.
- What the page is: a progress page at `/backstage/megagame/dashboard`, gated on `megagame.manage`, with concentration (shares, Gini, Lorenz curves, most active players), classes side by side with cumulative level bars, level transitions, join cohorts, the level grid and the CSV exports.
- What else changes: the export route is restored under `megagame.manage`; the Quest Board shows a "Dashboard" link to managers; the permission descriptions are updated; seven unused store queries are removed (list them).
- The list of this branch's commits, from `git log --reverse --format='- %h %s' megagame-volunteer..HEAD`.
- If the session has Linear access, a `Fixes META-###` line for the matching issue; otherwise leave it out.
- End with the attribution line that the executing session's instructions specify for PR descriptions.

Record the PR number and URL for the report.

### Task 17: Preview screenshots (report, do not iterate)

**Files:** none.

- [ ] **Step 1: Find the preview URL**

Wait for the Vercel deployment of the PR to finish (`gh pr checks <number> --repo tradingbootcamp/metagame-2026` shows the Vercel check as passing), then take the preview URL from the Vercel bot comment: `gh pr view <number> --repo tradingbootcamp/metagame-2026 --comments`. If the deployment fails, report the failure with its log link and stop.

- [ ] **Step 2: Check the screenshot prerequisites**

`node_modules/playwright` must exist and a Chromium must be available (`npx playwright install chromium-headless-shell`, or `SHOT_BROWSER=<path>`). If either is missing, ask before installing and say it is for the screenshots.

- [ ] **Step 3: Take the screenshots**

Run: `node scripts/preview-shot.mjs <preview-url> /backstage/megagame/dashboard "/backstage/megagame/dashboard?range=con&bucket=1d" /backstage/megagame`

The script signs in as the seed admin, who passes every permission check, and shoots each path at phone and desktop widths. If the script cannot sign in (an error from its sign-in step, or the screenshots show the sign-in form instead of the page), say so and stop; do not try other accounts or change the script.

- [ ] **Step 4: Look at the images and report**

Open each PNG in `preview-shots/` and check: no horizontal page overflow (the script also prints a warning), the charts present on both the phone and desktop shots, every table readable on the phone (horizontal scroll inside the bordered box is fine), the level grid and export links present, and the "Dashboard" link on the `/backstage/megagame` shots. Preview data may be empty; say so if the tables are all zeros. Report what you saw with the screenshot paths. If anything looks wrong, report it with the screenshots and do not change code.

- [ ] **Step 5: Clean up after the report**

Once the user has seen the screenshots, run `rm -rf preview-shots`.
