# Megagame progress dashboard: design (specs and effects)

Date: 2026-11-03. Settled with the user in the design session of 2026-11-01 to 2026-11-03. Builds on the volunteer tool (docs/superpowers/specs/2026-10-28-megagame-volunteer-tool-design.md) and its branch `megagame-volunteer`.

## 1. Purpose and audience

A page for the design team, during the con, answering two questions from the event log: are some things progressing faster than others (classes, level transitions, join cohorts), and how far are power users pulling away from everyone else (concentration of completions and level-ups). It reads only what the volunteer tool already records: `level_events`, `quest_completions`, `confirmations`, `quest_attempts`, and the user level columns. Nothing about the card game or session rewards is captured, by decision: without a photo of the level-up sheet such data would not be useful, and not much even then.

The user is trimming the existing `/backstage/megagame/dashboard` on the volunteer branch to only the recent-actions and voids log. The progress page absorbs the current level grid and the CSV export links from it; per-quest and per-volunteer counts are dropped.

## 2. Access and placement

- Route: `/backstage/megagame/progress`. Gated on `megagame.manage` (the page names players; volunteers keep the trimmed dashboard). Signed-out or unpermitted viewers get the same `SignIn` treatment as the other megagame pages.
- Linked from the Megagame tool home for holders of `megagame.manage`. No link is added to the dashboard page, so the user's trim of that page does not conflict with this work.
- Range and bucket pickers in the URL, as on the dashboard: presets `2h`, `today`, `con`; bucket sizes from the `BUCKET_SIZES` whitelist in `megagame-rules.ts`. The progress page has its own small `view.ts` for parsing the query string and computing the range; it does not import from the dashboard directory. Bucket math stays in `megagame-rules.ts`; con dates come from `CONFERENCE_DAYS` in `src/lib/schedule.ts`.
- The page refreshes every 60 s with the same `AutoRefresh` pattern (its own copy if the dashboard's component is removed).

## 3. Data loading and computation

Two store queries, each one HTTP request, load every live (non-voided) row:

- completions: `user_id`, quest `class` (null for any-class quests), `confirmed_at`;
- level events: `user_id`, `class`, `level`, `source`, `awarded_at`.

Plus: the player names for the ids that appear, the current level columns for the level grid, and the claimed-ticket holder count (reusing `claimedTicketHolderCount`). Deleted users (null `user_id`) are grouped as one pseudo-player, as the dashboard does.

A new pure module, `src/lib/megagame-progress.ts`, takes those arrays plus a range, bucket size and `now`, and returns every table in sections 4 to 7. No SQL aggregates: volumes are hundreds of players and low thousands of events, so one load and in-memory computation is cheaper than one query per metric, every metric is unit-testable with fabricated events, and "as of each bucket end" is uniform across sections. The module must not import the database.

## 4. Concentration

Definitions:

- Active player: at least one live completion. Leveling player: at least one live level event with source `volunteer`.
- Shares: sort players by count descending; the top-k% share is the fraction of all counts held by the first `ceil(k% x n)` players. Reported for k = 10, 20, 50. Ties are broken by earliest first activity, so the number is deterministic.
- Gini coefficient over the per-player counts, standard formula, 0 when n < 2.

Shown:

1. Headline figures: active players, completions, top-10/20/50% shares and Gini, for completions; the same block for volunteer level-ups over leveling players. The "80% of completions by 20% of active players" reading is these numbers.
2. Lorenz curve as an inline SVG: one line per class (completions of that class's quests over that class's active players) plus overall. Any-class quest completions count in overall only.
3. Over time: top-20% share and Gini for completions as of the end of each bucket in the range, as a table and a small line chart. A player's counts as of time t include only events before t.
4. Most active table: top 25 players by completions; name (or "Deleted account"), current levels, completions per class and any-class, volunteer level-ups, first and last activity. Sorted by completions, ties by first activity.

## 5. Classes side by side

One table per bucket with a column group per class: completions of that class's quests, volunteer level-ups in that class, distinct players active in that class (a completion of a class quest or a level event in that class), and that figure as a share of the class's current members (players with level >= 1 in the class, from the user columns). Any-class completions are a separate column. Totals row.

Below it, the cumulative level distribution for all three classes at once as of each bucket end: per bucket, three stacked bars (one per class, segments per level 1 to 5), from the level event log via the existing `cumulativeLevelDistribution`. Picker joins count as level 1 from their event time.

## 6. Level transitions

For each class and each transition n to n+1 (1 to 2 through 4 to 5):

- players who made it (live event at level n+1 with a prior live event at level n, or a picker join for n = 1);
- median and quartiles (25th, 75th) of the duration between the two events.

Duration rule: the start time is the later of the earlier event's time and con start (`CONFERENCE_DAYS[0]` at midnight Pacific), so "time at level 1" means time at the con before leveling, not time since a pre-con picker join. Skipped levels (an event at n+2 with none at n+1) are counted as a transition from n to n+2 in a separate "skipped" count and excluded from the n to n+1 durations.

Also per class and level: players currently at that level (user columns), and the median time since the live event that put them there, with the same con-start rule. Players at a level with no matching event (data from before the event log) are counted but left out of the median.

## 7. Cohorts

Cohort = Pacific calendar day of a player's first live completion or first live volunteer level event. Picker joins do not start a cohort. Cohorts always cover the whole con regardless of the range picker.

Per cohort: size, completions per player (mean and median), volunteer level-ups per player, share that reached level 2 or higher in any class, and a retention row: share of the cohort with any activity on each later con day. Claimed-ticket holders with no activity are shown as a single "not yet active" count with its share of holders.

## 8. Level grid and export

At the top of the page, the current class x level grid from the user columns, with percentages of claimed-ticket holders, copied from the dashboard. At the bottom, the CSV export links for the event tables, pointing at the existing export route (which stays on the volunteer branch).

## 9. Charts

Inline SVG only, no charting dependency, matching the dashboard's approach: a Lorenz plot, a line chart for the concentration series, stacked bars for the cumulative levels. Each has an `aria-label` and a table fallback. Bars and plots hide on phones where the dashboard hid them; the tables remain.

## 10. Effects on existing code

- No schema change. No change to the volunteer tool, the picker, the dashboard page, or the export route.
- New: `src/lib/megagame-progress.ts` with tests; two load queries in `megagame-store.ts` with mocked-DB tests; `src/app/backstage/megagame/progress/{page.tsx,view.ts,charts.tsx}` plus tests following the dashboard's `view.test.ts` and `pages.test.ts` patterns; one link on the tool home.
- The branch is based on `megagame-volunteer` and ships after that branch's PR. If the dashboard trim removes `view.ts`, `charts.tsx` or `AutoRefresh.tsx` from the dashboard directory, the progress page is unaffected because it has its own copies of what it needs.

## 11. Testing

Unit tests on the pure module: empty input; one player; ties in the share ranking; voided events excluded at load (the module assumes live rows, so a test checks the store query filters); deleted users as one pseudo-player; any-class completions in overall only; cohort day boundaries at Pacific midnight; con-start clamp on durations; skipped levels; "as of" series including only earlier events. Page tests for gating and for the range/bucket parsing. Preview screenshots on phone and desktop per CLAUDE.md before the PR.

## 12. Decisions settled with the user

- Audience is the design team only (2026-11-01).
- "Differentially" means concentration (power users vs everyone) and relative rates, not snapshot diffs (2026-11-01).
- No extra capture on level-up for the card game or sessions (2026-11-01).
- Comparison dimensions: classes, level transitions, join cohorts. Individual quests are not a dimension (2026-11-01).
- Cohort = day of first con activity, option 1 of three (2026-11-01).
- Gate on `megagame.manage`; durations clamp to con start; cohorts ignore the range picker (2026-11-03, "reasonable").
- The dashboard is being trimmed to the action log on the volunteer branch; the progress page absorbs the level grid and export links (2026-11-03, left to Claude).

## 13. Assumptions the design makes that the user did not state

Kept unless the user objects: top 10/20/50% as the share thresholds; Gini as the single inequality number; 25 rows in the most-active table; deleted users as one pseudo-player; any-class completions excluded from per-class figures; picker joins count as level 1 in the cumulative view but do not start a cohort; skipped levels reported separately rather than interpolated; level transitions exclude players whose current level has no event behind it; a 60 s refresh; no CSV export of the computed tables (the raw event export covers it).
