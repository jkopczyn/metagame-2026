# Hat Tricks page: implementation plan

Spec: `docs/superpowers/specs/2026-11-03-hat-tricks-page-design.md`. The spec is authoritative; this plan fixes interfaces and order, and adds two decisions made after the spec (the scoring grace period and preview-only overrides). Branch: `hat-tricks`, worktree `/home/jkop/Code/metagame-2026/.worktrees/hat-tricks`.

## Rules for every task

- Work only in this worktree. Do not touch `src/v2/hat-trick/` (singular) and do not import from it.
- Never open, read, quote, or commit `Hat Tricks - Metagame_LessOnline minigame.md` in the worktree root. Run `git status` before every commit and make sure it is not staged.
- The event schedule must not enter the repo in any form. Do not write any 2026 date in any file you add or change (the year in the name "Metagame 2026" is fine). Test fixtures and the `.env.example` example use the 2020 decoy weekend defined in A2, or small made-up 2020 schedules. The decoy is shaped like a weekend on purpose; it must never be edited to resemble the event's schedule.
- TDD: in each task, write the tests first, run them and see them fail, commit them (`test: ...`), then implement until they pass and commit (`feat: ...`). End every commit message with the co-author attribution line from your own session's instructions.
- Before each `feat` commit run `pnpm vitest run <the task's test files>`, `pnpm typecheck`, `pnpm lint`, and `pnpm format:check`. Fix formatting with `pnpm exec prettier --write <your files>`.
- Code comments: minimal, only for a non-obvious reason.
- Times inside the pure logic are `Date` objects. Anything passed to a client component is an ISO string or a preformatted label.

## Task 0 (setup, run once before the tracks start)

The worktree has no `node_modules`. Run `pnpm install` in the worktree (if `pnpm` is not on PATH, use `corepack pnpm`). Then read the Next.js 16 guides in `node_modules/next/dist/docs/` on route segment config (`dynamic`), the `metadata` export, page `searchParams` (a Promise in recent versions), server and client components, and `useRouter().refresh()` from `next/navigation`. Find them with `grep -ril "force-dynamic\|searchParams" node_modules/next/dist/docs | head`. No commit.

## Tracks and dependencies

| Track                      | Tasks      | Depends on                                                      |
| -------------------------- | ---------- | --------------------------------------------------------------- |
| A: hats and schedule       | A1, A2     | Task 0                                                          |
| B: scoring                 | B1         | A1, A2                                                          |
| C: schema and migration    | C1         | A1                                                              |
| D: SVG assets              | D1         | none                                                            |
| E: env var                 | E1         | A2 (for the decoy fixture)                                      |
| F: view model, store, page | F1, F2, F3 | F1 needs A2 and B1; F2 needs B1 and C1; F3 needs F1, F2, D1, E1 |

A1 is small and should land first so B, C, and F can import `HatId`. D1 can run at any time; E1 runs after A2. B1 and C1 can run in parallel. F1 and F2 can run in parallel. No two parallel tasks touch the same file.

---

## A1. Hat definitions

Files: create `src/lib/hat-tricks-hats.ts`, `src/lib/hat-tricks-hats.test.ts`.

Interface (client-safe: no database or `server-only` imports):

```ts
export const HAT_IDS = [
  "wizard",
  "saucer",
  "fuzzy",
  "slouch",
  "tricorn",
  "crown",
] as const;
export type HatId = (typeof HAT_IDS)[number];
export type Hat = { id: HatId; name: string; art: string; photo?: string };
export const HATS: readonly Hat[]; // in HAT_IDS order
export function isHatId(value: unknown): value is HatId;
export function hatById(id: HatId): Hat;
```

Names: Wizard hat, Alien saucer, Sparkly fuzzy hat, Satin slouch hat, Tricorn, Spiked crown. `art` is `/images/hat-tricks/<id>.svg`. `photo` is absent on all six.

Tests first:

- `HATS` ids equal `HAT_IDS` in order, and names match the list above.
- every `art` is `/images/hat-tricks/<id>.svg` and every `photo` is `/images/hat-tricks/<id>.jpg` (900x900 crops of the user's photos, added 2026-11-06).
- `isHatId` accepts each id and rejects `"beanie"`, `""`, `42`, `undefined`.
- `hatById("crown").name === "Spiked crown"`.

Commits: `test: hat tricks hat definitions`, then `feat: hat tricks hat definitions`.

## A2. Schedule parsing, shift state, shift changes

Files: create `src/lib/hat-tricks-schedule.ts`, `src/lib/hat-tricks-schedule.test.ts`, `src/lib/hat-tricks-decoy.fixture.ts`. The schedule module is pure and imports only from `./hat-tricks-hats`.

### The decoy fixture

`src/lib/hat-tricks-decoy.fixture.ts` (test-only; vitest only collects `*.test.ts`, so this file is not a test itself) exports:

```ts
export type RawShift = { start: string; end: string; hats: HatId[] };
export const DECOY_SHIFTS: RawShift[];
export const DECOY_JSON: string; // JSON.stringify(DECOY_SHIFTS), one line
```

It is a fake weekend, Friday 2020-01-03 to Sunday 2020-01-05, all times with offset `-08:00`. Build it with a small helper from this list of blocks, in order:

| #   | from      | to        | shift length     | count |
| --- | --------- | --------- | ---------------- | ----- |
| 1   | Fri 14:00 | Fri 22:00 | 4 h              | 2     |
| 2   | Fri 22:00 | Sat 08:00 | 10 h (overnight) | 1     |
| 3   | Sat 08:00 | Sat 22:00 | 2 h              | 7     |
| 4   | Sat 22:00 | Sun 09:00 | 11 h (overnight) | 1     |
| 5   | Sun 09:00 | Sun 13:00 | 20 min           | 12    |

That is 23 shifts. Hats for shift i (0-based over the whole list): `[HAT_IDS[i % 6]]`, plus `HAT_IDS[(i + 3) % 6]` as a second hat when `i % 3 === 2`. So shift 0 is `["wizard"]`, shift 2 (the Friday overnight) is `["fuzzy", "crown"]`, and shift 3 (Sat 08:00) is `["slouch"]`. The shifts are contiguous from Fri 14:00 to Sun 13:00, so the distinct change instants are 24.

Interface:

```ts
import type { HatId } from "./hat-tricks-hats";

export type Shift = { start: Date; end: Date; hats: HatId[] };
export type Schedule = readonly Shift[];

export class ScheduleParseError extends Error {}

/** undefined, "" or whitespace -> []. Anything invalid throws ScheduleParseError. */
export function parseSchedule(raw: string | undefined): Schedule;

/** The shift with start <= now < end, or null. */
export function currentShift(schedule: Schedule, now: Date): Shift | null;

/** The first shift with start >= now, or null. */
export function nextShift(schedule: Schedule, now: Date): Shift | null;

export type ShiftState =
  | {
      kind: "on";
      hats: HatId[];
      endsAt: Date;
      next: { startsAt: Date; endsAt: Date } | null;
    }
  | { kind: "off"; nextStartsAt: Date }
  | { kind: "done" }
  | { kind: "standing"; hats: HatId[] };

export function shiftState(schedule: Schedule, now: Date): ShiftState;

export type Bounds = { from: "open" | "closed"; to: "open" | "closed" };

/**
 * Distinct shift start/end instants between from and to, ascending.
 * Default bounds are { from: "open", to: "closed" }, i.e. (from, to], as in the spec.
 */
export function shiftChangesBetween(
  schedule: Schedule,
  from: Date,
  to: Date,
  bounds?: Bounds,
): Date[];
```

Parsing rules. Each failure throws `ScheduleParseError`. Errors about one entry start with `shift N: ` where N is the 1-based position in the array.

- JSON parse failure; top level not an array; an entry that is not an object.
- `start` or `end` missing or not a string matching `^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):(\d{2}))$`.
- Calendar-invalid values. Build the wall time with `Date.UTC(y, m - 1, d, h, mi, s, ms)` and reject unless `getUTCFullYear/Month/Date/Hours/Minutes/Seconds` give back the same components (this rejects 2020-02-30, 2021-02-29, hour 25, minute 60). Reject offsets with hours above 14 or minutes above 59. Then subtract the offset to get the instant. Do not use `new Date(string)` for validation, since it rolls invalid days over.
- `end <= start`.
- `hats` not an array, empty, longer than 2, containing an unknown id (the message names the id), or containing a duplicate.
- For consecutive entries, `prev.end !== next.start` (a gap, an overlap, or out of order). Shifts are contiguous.
- Unknown keys on an entry are ignored, so a harmless extra key does not blank the page.

Shift state: empty schedule gives `standing` with hats `["tricorn"]`. Inside shift i gives `on` with `nextEndsAt = schedule[i + 1]?.end ?? null`; since shifts are contiguous the next start is the current end. Otherwise, if `nextShift` exists, `off` with its start. Otherwise `done`.

Tests first. Fixture helper `shift(startHHMM, endHHMM, hats)` building ISO strings on `2020-01-01` with offset `-08:00`.

- `parseSchedule`: a valid two-shift value gives the right Dates and hat arrays; `undefined`, `""`, `"   "`, and `"[]"` give `[]`; an extra key is ignored. Error cases, each `toThrow(ScheduleParseError)`: malformed JSON; non-array; unknown hat id (message contains the id); three hats; empty hats; duplicate hat; overlapping shifts; a gap between shifts; out-of-order shifts; `end` equal to `start`; no offset (`"2020-01-01T10:00:00"`); `2020-02-30T10:00:00-08:00`; `2021-02-29T10:00:00-08:00`; hour `25`; offset `+25:00`. One test checks that an error in the second entry has a message starting `shift 2:`. One test checks that `2020-02-29T10:00:00-08:00` (a valid leap day) parses.
- `currentShift`/`nextShift`: inside, before first, after last, at a shift's exact start (current is that shift), at an exact end that is the next shift's start (current is the next shift), at the last end (current is null).
- `shiftState`: `standing` with `["tricorn"]` for `[]`; `on` with `nextEndsAt` set when a shift follows; `on` in the last shift with `nextEndsAt: null`; `off` before the first shift; `done` at and after the last end.
- Decoy: `parseSchedule(DECOY_JSON)` gives 23 shifts; `shiftChangesBetween` from Fri 13:00 to Sun 13:00 gives 24 instants; `shiftState` at Sat 03:00 is `on` (overnight) ending Sat 08:00 with `nextEndsAt` Sat 10:00; at Fri 13:00 is `off` with `nextStartsAt` Fri 14:00; at Sun 12:50 is `on` with `nextEndsAt: null`; at Sun 13:00 is `done`.
- `shiftChangesBetween`: back-to-back shifts produce one change at the shared instant; with default bounds, `from` is excluded and `to` included when either equals a change; with `{ from: "closed", to: "open" }` the reverse; with both closed, both included; `from > to` gives `[]`; empty schedule gives `[]`.

Commits: `test: hat tricks schedule parsing and shift state`, then `feat: hat tricks schedule parsing and shift state`.

## B1. Scoring

Files: create `src/lib/hat-tricks-score.ts`, `src/lib/hat-tricks-score.test.ts`. Pure; imports `shiftChangesBetween` and types from A1 and A2.

Interface:

```ts
import type { HatId } from "./hat-tricks-hats";
import type { Schedule } from "./hat-tricks-schedule";

export type Steal = { hatId: HatId; userId: string; stolenAt: Date };
export type Tally = { userId: string; steals: number; points: number };
export type HatScores = { overall: Tally[]; byHat: Record<HatId, Tally[]> };
export type LeaderRow = {
  rank: number;
  userId: string;
  name: string;
  steals: number;
  points: number;
};

export const THEFT_POINTS = 5;
export const DEFAULT_GRACE_MS = 60_000;

export function scoreHats(
  schedule: Schedule,
  steals: readonly Steal[],
  now: Date,
  options?: { graceMs?: number }, // defaults to DEFAULT_GRACE_MS
): HatScores;
export function rankTallies(
  tallies: readonly Tally[],
  names: ReadonlyMap<string, string>,
): LeaderRow[];
export function lastSteals(
  steals: readonly Steal[],
  now: Date,
): Map<HatId, Steal>;
```

`scoreHats`:

- Ignore steals with `stolenAt > now`.
- Per hat, stable-sort that hat's steals by `stolenAt` (input order breaks ties; the store supplies rows already ordered by `stolenAt, createdAt, id`).
- Each steal adds 1 steal and `THEFT_POINTS` to its thief.
- Grace: each steal gets an effective start. Let c be the latest shift change with `c <= stolenAt` (use all changes in the schedule up to `now`). If `stolenAt - c <= graceMs` and no earlier steal of the same hat has `stolenAt > c`, the effective start is c; otherwise it is `stolenAt`. The second condition keeps effective starts in order: only the first steal of a hat after a change can be moved back to it. `graceMs = 0` turns grace off (a steal exactly at a change still has effective start c, which is the same instant). Grace changes only interval boundaries for holding points; it does not change theft points, `lastSteals`, or any displayed time.
- Holding interval k runs from effective start k to effective start k+1, or to `now` for the last steal. For a non-final interval use `shiftChangesBetween(schedule, start, end, { from: "closed", to: "open" })`; for the final interval use `{ from: "closed", to: "closed" }` with `end = now`. The n-th change in an interval (1-based) gives the holder `2n - 1`. This gives each change to whoever holds the hat at that instant, a change at the instant of a steal to the new thief, and a change at exactly `now` to the current holder. No change is counted twice.
- `byHat` has a key for every hat id (empty array when no steals). `overall` sums per user across hats. Tallies are unsorted; `rankTallies` sorts.

`rankTallies`: sort by points desc, steals desc, name asc (`localeCompare`; a missing name falls back to `"Unknown"`). Rows equal on both points and steals share a rank, and the next distinct row's rank is its 1-based position (1, 1, 3). Users with zero steals never have a tally, so they never appear.

`lastSteals`: per hat, the latest steal with `stolenAt <= now` (the last in stable order on ties), using the recorded `stolenAt`.

Tests first, with a fixture schedule on 2020-01-01 of back-to-back shifts 10:00-11:00, 11:00-12:00, 12:00-13:00 (changes at 10:00, 11:00, 12:00, 13:00). Pass `{ graceMs: 0 }` in every test except the grace tests, so the boundary tests are not affected by grace.

- no steals: `overall` is `[]`, every `byHat` entry is `[]`.
- one steal at 10:30, `now` 10:45: 5 points, 1 steal.
- one steal at 09:30, `now` 12:30: changes 10, 11, 12 give 1+3+5, total 14.
- steal back: A at 09:30, B at 10:30, A at 11:30, `now` 12:30. A gets 6 + 6 = 12 with 2 steals; B gets 6.
- steal at the instant of a change: A at 09:30, B at 11:00, `now` 11:30. A gets 5+1 (10:00 only), B gets 5+1 (11:00).
- change at `now`: steal at 10:30, `now` 11:00 exactly gives 5+1.
- no double count: A at 10:30, B at 11:00, `now` 11:00. A gets 5 (A's non-final interval excludes 11:00); B gets 5+1. Total holding points across both users is 1.
- one user holding two hats: separate per-hat tallies, summed in `overall`.
- a steal after `now` is ignored.
- grace (default options): A at 09:30, B at 11:00:30, `now` 11:30. B gets the 11:00 change (5+1), A gets only 10:00 (5+1). With B at 11:01:30 instead, A gets 10:00 and 11:00 (5+1+3) and B gets 5. With `{ graceMs: 0 }` and B at 11:00:30, A gets 5+1+3 and B gets 5.
- grace with two quick steals: A at 09:30, B at 11:00:20, C at 11:00:40, `now` 11:30. B's effective start is 11:00, so B gets 5+1; C's stays 11:00:40, so C gets 5.
- `rankTallies`: ordering by points, then steals, then name; tie sharing (1, 1, 3); unknown name falls back.
- `lastSteals`: latest per hat, ignores future steals, absent for unstolen hats, keeps the recorded time even when grace would move the start.
- Decoy, default grace: A steals wizard at Fri 15:00, `now` Sat 09:00. Changes at Fri 18:00, Fri 22:00, Sat 04:00, Sat 08:00 give 1+3+5+7, so A has 21. B steals crown at Sun 09:05, `now` Sun 10:00: changes 09:20, 09:40, 10:00 give 1+3+5, so B has 14. Overall has both.

Commits: `test: hat tricks scoring`, then `feat: hat tricks scoring`.

The volunteer recording page (later work) will refine how grace interacts with recording; this task only implements the rule above.

## C1. Table and migration

Files: create `src/db/schema/hat-tricks.ts`; change `src/db/schema/index.ts` (add `export * from "./hat-tricks";`), `src/db/describe.ts`, `src/db/describe.test.ts`; generated files under `drizzle/` (a new `0028_hat_steals.sql` today, an updated `drizzle/meta/_journal.json`, a new snapshot).

Table (follow `src/db/schema/schedule.ts` style; casing is snake_case from the drizzle config, so use camelCase keys without explicit column names):

```ts
export const hatSteals = pgTable(
  "hat_steals",
  {
    id: uuid().primaryKey().defaultRandom(),
    hatId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    stolenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    recordedBy: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("hat_steals_hat_stolen_at_idx").on(t.hatId, t.stolenAt),
    check(
      "hat_steals_hat_id_known",
      sql`${t.hatId} in (${sql.raw(HAT_IDS.map((id) => `'${id}'`).join(", "))})`,
    ),
  ],
);
```

Do not use the `timestamps` helper: the table has no `updatedAt`. Import `HAT_IDS` with a relative import (`../../lib/hat-tricks-hats`) so drizzle-kit resolves it without the `@/` alias.

Tests first, in `src/db/describe.test.ts` (it already reads every table through `describeSchema()`):

- add `"hat_steals"` in sorted position to the expected table list near line 18;
- add the group name `"Megagame"` at the end of the expected group list, and `"hat_steals"` at the end of the flattened table list;
- add a test that `hat_steals` has columns `id, hat_id, user_id, stolen_at, recorded_by, created_at` with the nullability above, that `user_id` and `recorded_by` reference `user.id`, and that it has the index on `hat_id, stolen_at`. Follow the existing helpers (`table(...)`, `column(...)`) in that file.

Implementation: the table file and index export; in `src/db/describe.ts` add `Megagame: ["hat_steals"]` as the last entry of `TABLE_GROUPS`, and a `TABLE_NOTES` entry: `hat_steals: "One row per hat theft in the Hat Tricks minigame (/hat-tricks). user_id is the thief; recorded_by is the volunteer who logged it (null for backfills). Scores are computed from these rows and the shift schedule, which lives only in the HAT_TRICKS_SCHEDULE env var."`

Then run `pnpm db:generate --name hat_steals` (it does not need a database; if it complains about `DATABASE_URL`, prefix `DATABASE_URL=postgres://x@localhost/x`). Read the generated SQL: it must create the table, both foreign keys, the index, and a check listing exactly the six ids, and nothing else. Never hand-edit it. The number is 0028 today. If main gains a newer migration before merge, delete the generated files and rerun the command after rebasing; never renumber by hand.

Commits: `test: hat_steals table`, then `feat: hat_steals table and migration`.

## D1. SVG assets

Files: create `public/images/hat-tricks/{wizard,saucer,fuzzy,slouch,tricorn,crown,stack}.svg`. No tests (static assets); one commit.

Sources in `~/Documents/metagame/hat-trick-medals/`:

| source                     | destination   |
| -------------------------- | ------------- |
| `01_wizard_art.svg`        | `wizard.svg`  |
| `02_ufo_art.svg`           | `saucer.svg`  |
| `04_sparkly_fuzzy_art.svg` | `fuzzy.svg`   |
| `05_satin_slouch_art.svg`  | `slouch.svg`  |
| `06_tricorn_art.svg`       | `tricorn.svg` |
| `07_spiked_crown_art.svg`  | `crown.svg`   |
| `08_hat_stack_all_six.svg` | `stack.svg`   |

Every source has, as direct children of `<svg>` before `<g id="art"...>`, exactly these two elements, which are the only ones to remove:

```
<rect width="1000" height="1000" fill="#fff"/>
<circle cx="500" cy="500" r="470" fill="none" stroke="#f00" stroke-width="3"/>
```

Remove each with a literal string replacement (for example a short Node script using `String.prototype.replace` with these exact strings, failing if either is not found exactly once). Keep everything else byte for byte, including the `<svg>` attributes, `viewBox="0 0 1000 1000"`, and the whole `<g id="art">` subtree. Keep the `fill="white"` groups inside `stack.svg`: they make overlapping hats hide the lines behind them. Do not edit the source files.

Verify: `grep -c 'fill="#fff"\|#f00' public/images/hat-tricks/*.svg` prints 0 for every file; `grep -c '<g id="art"'` prints 1 for every file; each file starts with the same `<svg ...>` tag as its source. Do not copy the PNGs, the medal SVGs, or the beanie.

Commit: `feat: add hat tricks line art`.

## E1. Environment variable

Files: change `src/env.ts` and `.env.example`; create `src/lib/hat-tricks-env-example.test.ts`.

- In `ENV_SPEC`, add `{ name: "HAT_TRICKS_SCHEDULE", required: false, description: "JSON array of Hat Tricks shifts ({start, end, hats}) for /hat-tricks. Set only in Vercel; the real schedule must never be committed. Unset means the pirate tricorn is the only hat, stealable the whole time." }`.
- In the `env` object, add `HAT_TRICKS_SCHEDULE: process.env.HAT_TRICKS_SCHEDULE,`.
- In `.env.example`, add a commented block in the file's style: a comment line saying what it is and that the real value is set only in Vercel, then `# HAT_TRICKS_SCHEDULE=<DECOY_JSON>` on one line, with the value printed from the A2 fixture (for example `pnpm exec tsx -e 'import("./src/lib/hat-tricks-decoy.fixture.ts").then(m => console.log(m.DECOY_JSON))'`, or any equivalent).

Test first (`src/lib/hat-tricks-env-example.test.ts`): read `.env.example`, find the line starting `# HAT_TRICKS_SCHEDULE=`, and assert that the rest of the line equals `DECOY_JSON` and that `parseSchedule` accepts it. This keeps the example and the fixture identical.

Commits: `test: .env.example hat tricks example matches the decoy`, then `chore: declare HAT_TRICKS_SCHEDULE env var`.

## F1. Time formatting, view model, preview overrides

Files: create `src/lib/hat-tricks-format.ts`, `src/lib/hat-tricks-view.ts`, `src/lib/hat-tricks-view.test.ts`.

`src/lib/hat-tricks-format.ts` (client-safe; imports `PACIFIC` from `@/lib/schedule`, which has no database imports):

```ts
/** "Sat 3:45 PM" in Pacific. */
export function formatShiftTime(at: Date | string): string;
/** "Sat 3:45:07 PM" in Pacific, for the ticking clock. */
export function formatClockTime(at: Date | string): string;
```

Use `Intl.DateTimeFormat("en-US", { timeZone: PACIFIC, weekday: "short", hour: "numeric", minute: "2-digit", (second: "2-digit"), hour12: true })`, then remove any comma after the weekday and replace U+202F and U+00A0 with a plain space, so output does not vary by ICU version.

`src/lib/hat-tricks-view.ts` (pure; no database and no `env` import; the page passes raw values in):

```ts
export type HatCardView = {
  id: HatId;
  name: string;
  art: string;
  photo: string; // photo falls back to art
  lastStolen: { name: string; atLabel: string } | null;
};
export type StateView =
  | {
      kind: "on";
      hats: HatCardView[];
      endsAt: string;
      endsAtLabel: string;
      nextLine: string | null;
    }
  | { kind: "off"; nextStartsAt: string; nextStartsAtLabel: string }
  | { kind: "done" }
  | { kind: "standing"; hats: HatId[] };
export type HatTricksView = {
  nowIso: string;
  nowLabel: string; // formatClockTime(now)
  state: StateView;
  overall: LeaderRow[];
  perHat: { id: HatId; name: string; rows: LeaderRow[] }[];
};

export function buildHatTricksView(input: {
  rawSchedule: string | undefined;
  steals: readonly Steal[];
  names: ReadonlyMap<string, string>;
  now: Date;
  onScheduleError?: (error: unknown) => void;
}): HatTricksView;

export type PreviewOverrides = {
  rawSchedule: string;
  now?: Date;
  data?: { steals: Steal[]; names: Map<string, string> };
};
export function previewOverrides(
  searchParams: Record<string, string | string[] | undefined>,
  vercelEnv: string | undefined,
): PreviewOverrides | null;
```

`buildHatTricksView`:

- Parse with `parseSchedule`; on any throw call `onScheduleError` and use `[]`, which gives the `standing` tricorn state and scores with no shift changes.
- Score with `scoreHats` (default grace), rank with `rankTallies`, build cards with `lastSteals`.
- `nextLine` for the `on` state: `null` when `next` is null; `"The shift after that ends at {formatShiftTime(next.endsAt)}"` when `next.startsAt` equals `endsAt`; otherwise `"The next shift runs {formatShiftTime(next.startsAt)} to {formatShiftTime(next.endsAt)}"`. Only this string goes to the browser, never `next` as data.
- `perHat`: the on-shift hats in shift order in the `on` state; all six in `HATS` order in the `done` state; the standing hats in `standing`; empty in `off`.
- The output contains only what the spec allows the browser to see.

`previewOverrides`: return `null` when `vercelEnv === "production"` or when `schedule` is absent (take the first value if it is an array). Otherwise return `{ rawSchedule: schedule }`, plus `now` when the `now` parameter parses to a valid Date (ignored otherwise), plus `data` when a `steals` parameter is present: parse it as a JSON array of `{ hatId, userId, stolenAt }`, dropping entries with an unknown hat id or invalid date, and parse `names` as a JSON object of userId to name. Malformed `steals` JSON gives an empty list; malformed or missing `names` gives an empty map. `now` without `schedule` is ignored, so the real schedule is never combined with a shifted clock.

Tests first (fixture on 2020-01-01: shift 1 10:00-11:00 `["wizard"]`, shift 2 11:00-12:00 `["crown", "fuzzy"]`, shift 3 13:00-14:00 `["tricorn"]`, shift 4 14:00-15:00 `["saucer"]`):

- `formatShiftTime("2020-01-04T15:45:00-08:00")` is `"Sat 3:45 PM"`; `formatClockTime` adds seconds; output contains no U+202F.
- at 10:30: state `on`, one card for wizard with `photo` `/images/hat-tricks/wizard.jpg`, `endsAt` 11:00, `nextLine` "The shift after that ends at Wed 12:00 PM"; `perHat` has only wizard.
- at 11:30: `nextLine` is "The shift after that ends at Wed 1:00 PM".
- at 13:30: `nextLine` is `null`.
- secrecy, on state: at 10:30 with steals only of wizard, `JSON.stringify(view)` does not contain `"crown"`, `"fuzzy"`, `"Spiked crown"`, or `"Sparkly fuzzy hat"`.
- secrecy, off state: at 09:30 with steals only of wizard, state `off` with next start 10:00, `perHat` is `[]`, and `JSON.stringify(view)` does not contain `"tricorn"` or `"Tricorn"`.
- At 14:00: `done`, and `perHat` lists all six hats in order.
- invalid raw schedule: `onScheduleError` called once, state `standing` with the tricorn, `perHat` `["tricorn"]`, and a seeded steal still yields 5 points in `overall`.
- `lastStolen` shows the thief's name and `atLabel`, or `null` when the hat has no steals.
- Decoy: at Fri 13:00 (before the first shift) with steals only of crown, state `off` with `nextStartsAtLabel` "Fri 2:00 PM", and `JSON.stringify(view)` contains neither `"wizard"` nor `"Wizard hat"` (the hat of the first shift). At Sun 09:10, `endsAtLabel` is "Sun 9:20 AM" and `nextLine` is "The shift after that ends at Sun 9:40 AM".
- `previewOverrides`: `"production"` returns `null` even with every parameter set; `now` without `schedule` returns `null`; `schedule` alone returns only `rawSchedule`; a valid `now` is returned, an invalid one dropped; `steals` and `names` parse, unknown hat ids are dropped, malformed `steals` gives an empty list; `vercelEnv` `"preview"` and `undefined` both allow overrides.

Commits: `test: hat tricks view model`, then `feat: hat tricks view model`.

## F2. Steals store

Files: create `src/lib/hat-tricks-store.ts`. No unit test: it is one query, and the logic it feeds is tested in B1 and F1. Commit on its own: `feat: load hat steals`.

```ts
import "server-only";
export async function loadSteals(): Promise<{
  steals: Steal[];
  names: Map<string, string>;
}>;
```

Select `hatSteals.hatId, userId, stolenAt` joined to `user` for `user.name`, ordered by `stolenAt, createdAt, id`, through `getDb()`. Filter rows with `isHatId` (the check constraint makes this a type narrowing only).

## F3. Components and page

Files: create `src/v2/hat-tricks/HatClock.tsx`, `src/v2/hat-tricks/HatCard.tsx`, `src/v2/hat-tricks/Leaderboard.tsx`, `src/v2/hat-tricks/Rules.tsx`, `src/app/(v2)/hat-tricks/page.tsx`; change `src/v2/components/ContentPage.tsx`. No rendering tests (spec). Commit: `feat: hat tricks page at /hat-tricks`.

- `ContentPage.tsx`: add an optional prop `above?: React.ReactNode`, rendered inside the `<header>` before the eyebrow and the `<h1>`. No other change; existing callers are unaffected.
- `page.tsx`:
  - `export const dynamic = "force-dynamic";` and `export const metadata: Metadata = { title: "Hat Tricks — Metagame 2026", description: "A hat trick is when you trick someone and take their hat." }`.
  - The default export is async and receives `searchParams` (await it, per the Next 16 docs). `const overrides = previewOverrides(params, process.env.VERCEL_ENV)`. Then `now = overrides?.now ?? new Date()`, `rawSchedule = overrides ? overrides.rawSchedule : env.HAT_TRICKS_SCHEDULE`, and `{ steals, names } = overrides?.data ?? await loadSteals()`. Build the view with `onScheduleError: (e) => console.error("HAT_TRICKS_SCHEDULE:", e)`. Do not catch database errors (the existing `src/app/error.tsx` handles them).
  - Wrap in `ContentPage` with `title="Hat Tricks"`, `intro` set to the tagline, and `above` set to the stack image (`/images/hat-tricks/stack.svg`, decorative, `alt=""`).
  - Sections in this order: on shift now, clock, leaderboards plus the scoring line, rules. All user-facing text exactly as in the spec. Use classes from `src/v2/components/styles.ts` and the colour tokens other v2 pages use (`text-navy`, `text-ink/70`).
- `HatCard.tsx` (server): the SVG and the photo slot side by side, using plain `<img>` with the same `// eslint-disable-next-line @next/next/no-img-element -- <reason>` comment style as `src/v2/components/Avatar.tsx`; the name; and "Last stolen by {name}" with `atLabel`, or "Not stolen yet".
- `HatClock.tsx` (`"use client"`): props `{ nowIso: string; nowLabel: string; refreshAt: string | null; endsAtLabel: string | null; nextLine: string | null }`. First render shows `nowLabel` (server-formatted, so no hydration mismatch). On mount, compute `offset = Date.parse(nowIso) - Date.now()` and tick every second showing `formatClockTime(Date.now() + offset)`. When the corrected time reaches `refreshAt`, call `router.refresh()` once for that value; keep the guard in a ref keyed by `refreshAt`, so a new `refreshAt` after the refresh can trigger again. The page passes `refreshAt` as the current shift's `endsAt` in the `on` state, `nextStartsAt` in the `off` state, and `null` otherwise. Show "This shift ends at {endsAtLabel}" and then `nextLine` when present. The component receives nothing else.
- `Leaderboard.tsx` (server): props `{ title: string; rows: LeaderRow[] }`; a table with rank, name, steals, points; "No steals yet." when empty. Render "Overall" first, then one per entry in `view.perHat`.
- `Rules.tsx` (server): a `RULES` constant of four `{ title, body }` with the spec's text verbatim, rendered as four independent `<details>` elements (no `name` attribute, closed by default) with the title in `<summary>`.

Verification: `pnpm check` passes. Then push and follow the repo CLAUDE.md "Looking at UI changes" section against the Vercel preview, on mobile and desktop, using the preview-only overrides so every state can be seen. Build the paths with `encodeURIComponent` in a short Node one-liner, using `DECOY_JSON` as the schedule and fake steals and names:

- `on` with one hat (`now` Fri 15:00) and with two hats (`now` Sat 00:00, the overnight shift), each with a populated leaderboard (several fake users and steals);
- `off` (`now` Fri 13:00, before the first shift);
- `done` (`now` Sun 14:00, all six per-hat tables);
- `standing` (`schedule=[]`, or `schedule=notjson`);
- the plain path with no parameters.

Pass each path to `node scripts/preview-shot.mjs <preview-url> <path…>`. Surface the screenshots to the user rather than iterating, and delete them afterwards. Never put the fake values in a committed file.

---

## Decisions and assumptions

1. Module layout: `src/lib/hat-tricks-hats.ts`, `-schedule.ts`, `-score.ts`, `-format.ts`, `-view.ts`, `-store.ts`; UI in `src/v2/hat-tricks/`.
2. `shiftChangesBetween` takes an optional `bounds` argument; scoring uses closed-start intervals through it instead of adjusting times.
3. Parse error messages name the entry as `shift N` (1-based). Parsing also rejects `end <= start`, duplicate hats in a shift, out-of-order entries, timestamps without an offset, calendar-invalid timestamps, and offsets above 14 hours. Unknown keys are ignored.
4. Shifts are contiguous (user decision 2026-11-04: reject gaps). `nextEndsAt` in the `on` state is the following shift's end; its start is always the current end.
5. Steals with `stolenAt` after `now` are ignored in scoring and in "Last stolen by".
6. Grace: a steal within `graceMs` (inclusive) after the latest change is scored from that change, but only for the first steal of that hat after the change. This ordering rule is my choice; the user's decision did not cover two steals inside one grace window.
7. Same-instant steals of one hat are ordered by `createdAt`, then `id` (store order); the pure code keeps input order.
8. Ties: rows equal on points and steals share a rank (1, 1, 3); the name only orders them.
9. The clock shows seconds ("Sat 3:45:07 PM"); shift times do not ("Sat 3:45 PM"). The client corrects for clock skew using the server time.
10. Not in the spec: the clock calls `router.refresh()` when the current shift ends or the next one starts, so an open page does not keep showing hats that are no longer on shift. It sends no extra data to the browser.
11. Preview overrides are enabled whenever `VERCEL_ENV` is not `"production"`, which includes local dev where it is unset. With a `steals` override the database is not queried; with only `schedule` and `now`, the real steals are used.
12. The store and page have no unit tests; all branching logic is in the pure modules.
13. The decoy rotates hats by index and adds a second hat on every third shift; the user asked for rotation and some two-hat shifts but not this exact pattern. Its blocks and gaps (Fri 14:00 to Sun 13:00) are my choice.
14. The `.env.example` example is the whole decoy on one long line, checked against the fixture by a test.
15. The migration is generated with `--name hat_steals` to match the repo's named migrations; `describe.ts` gets a new "Megagame" group.
