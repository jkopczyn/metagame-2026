# Megagame volunteer tool: design (specs and effects)

Date: 2026-10-28. Reviewed by three agents and revised; decisions below were settled with the user on the same day. Three more were settled on 2026-11-01 (section 10). The schema section is applied only once the database is stable.

## 0. Repo facts the design relies on (verified at commit 6ba4bbe)

- The admin area is `/backstage`; `/admin` redirects there. The index is a hard-coded `TOOLS` array filtered by permissions held.
- Permissions: catalog in `src/lib/permissions.ts`; roles and per-user grants in Postgres; no migration to add a key. `permissions.test.ts` requires each group contiguous and ordered view, edit, delete.
- DB driver is `drizzle-orm/neon-http`: one HTTP request per query, no interactive transactions. `db.batch()` exists. drizzle 0.45 supports partial unique indexes and `onConflictDoNothing({target, where})`.
- No QR scanning, camera use, or charting library. QR generation exists. `jsqr` is a devDependency and works on iOS; `BarcodeDetector` does not work on any iOS browser.
- Ticket codes: 6 Crockford chars, `normalizeTicketCode` / `formatTicketCode` in `src/lib/ticket-code-format.ts`, entered through `PinInput` (fixed length, needs a `key` to reset). Ticket codes rotate on unclaim.
- `PinInput`, `QrDownload`, `uploadImage` (Vercel Blob, 900 KB cap under the server-action body limit) and `downscaleImage` (browser-side) are reusable.
- `src/db/describe.ts` and its test enumerate tables and groups; new tables must be added there. Side finding: the budget tables appear in neither, so that test may already fail. Not checked because node_modules is not installed in this worktree.
- `/u/[id]` profiles 404 for signed-out viewers and for non-public profiles unless the viewer holds `profiles.view`.
- `removeUser` hard-deletes the user row.
- Sessions already carry `megagameIntegrationLevel`.
- Added on main after this design was first written (commit 3351fab): the `user` table has `wizard_level`, `pirate_level` and `alien_level` columns (smallint, default 0, checked 0 to 5), read and written by `src/lib/megagame-store.ts`. The faction picker on `/account` (`chooseMegagameClass` in `src/app/(v2)/account/actions.ts`) sets level 1 in the chosen class and 0 in the others.

## 1. Scope

In scope for this feature cycle:

1. `/backstage/megagame`: verification tool for staff and designated volunteers. Open a quest by typed label code or by scanning its QR; see the checker; confirm completion for a set of players.
2. Level-up action with soft checks and a "Yes, I'm sure" override.
3. `/backstage/megagame/dashboard`: level and completion distribution, and change over time with bucket sizes from 5m to 1d.
4. Stable player identification, typed first, scannable later.

Out of scope for this cycle, with room left in the model: session reward tracking, card game tracking, player-facing progress, a public API.

## 2. Access

Two permission keys in a new "Megagame" group, both level edit, audience team:

- `megagame.verify`: the verification tool, level-ups, and the dashboard. The "Megagame volunteer" role holds this. Anyone who can record confirmations may look at the dashboard.
- `megagame.manage` (implies `megagame.verify`): quest import and editing, voiding anyone's records, editing requirements.

The volunteer flag is a role created on `/backstage/roles` and assigned on `/backstage/users/[id]` at shift start. No user column is needed now; if one is added later for other reasons, the gate stays the permission. Volunteers holding only `megagame.verify` see a `/backstage` index with one tile, which is the behavior the user asked for.

Effect on existing code: two catalog entries and one `TOOLS` entry. Roles grid and access panel pick the group up automatically.

## 3. Identification

### 3.1 Players

A player is a `user` row. Lookup paths in the tool, in order of expected use:

1. Typed code via `PinInput` (6 chars, Crockford, ticket normalizer).
2. Name search (own action gated on `megagame.verify`; returns name, pronouns, photo thumbnail; never creates accounts).
3. In-page QR scanner (jsQR, dynamic import, a few frames per second), later phase.

Badges will carry a per-person code, a QR, or both (badge design not final). New table `player_codes(user_id pk, code unique, created_at)`, generated in bulk by a script before badge printing and lazily otherwise. The badge QR, if printed, encodes `https://<site>/p/<code>`. The code is also shown on `/account` so a player can read it out.

`/p/<code>` behavior: for a viewer with `megagame.verify`, redirect to `/backstage/megagame?player=<code>` (adds the player to the current list). For anyone else: a page showing the player's display name and class levels, nothing from the private profile. Scanning a badge with the native camera therefore adds one player; building a group of several by scanning needs the in-page scanner, since the native camera opens each scan in a new tab. Typed entry is the primary path per the user.

The in-progress player list is kept in the URL query string so a reload, tab switch or camera detour does not lose it.

Players without an account cannot be recorded; volunteers send them to `/login`. Players without a claimed ticket are shown with a warning, not blocked (staff, speakers and comps may not have claimed tickets).

### 3.2 Quests

`quests.code` is the label code: 6 Crockford characters (fixed length so `PinInput` works), generated or chosen at import. Printed as text and as a QR encoding `https://<site>/q/<code>`.

- Viewer with `megagame.verify`: redirect to `/backstage/megagame/q/<code>`.
- Signed-out volunteer: `/login?next=/q/<code>` works today via `safeNextPath`.
- Anyone else: redirect to their own account page (`/account`; signed-out viewers go through `/login?next=/account`). Nothing about the quest is shown.

## 4. Data model (proposal, applied when the schema is stable)

Class is `text` with an app-side check against `["pirate","wizard","alien"]`, not a Postgres enum, so renaming or adding a class needs no migration. All event tables are append-only with void columns instead of deletes.

```
quests
  id uuid pk
  code text unique                  -- normalized label code
  title text not null
  class text null                   -- null = any class
  kind text not null                -- 'answer' | 'evidence'
  answers text[] not null default '{}'   -- normalized accepted answers
  evidence text null                -- "this photo shows six people in a human pyramid"
  hint text null                    -- player-facing, optional
  min_level int null, max_level int null
  active boolean not null default true
  created_at, updated_at
  check: class is not null or (min_level is null and max_level is null)   -- lock windows need a class

confirmations                        -- one row per confirm action; the idempotency key and undo unit
  id uuid pk                         -- generated by the client when the form opens, and regenerated after every successful confirm
  quest_id -> quests
  requested_user_ids text[] not null -- the players the volunteer asked to record, so retries and reloads can rebuild the result
  confirmed_by -> user (set null), nullable
  created_at timestamptz
  voided_at, voided_by (set null), void_reason

quest_completions
  id uuid pk
  confirmation_id -> confirmations
  quest_id -> quests                 -- copied from the confirmation by the store (needed for the partial index)
  user_id -> user (set null), nullable      -- see retention, section 8
  confirmed_at timestamptz
  voided_at, voided_by, void_reason          -- copied from the confirmation on undo so the partial index clears
  partial unique (quest_id, user_id) where voided_at is null and user_id is not null

level_events                         -- the audit log of level changes; current levels are on the user columns
  id uuid pk                         -- client-generated, the idempotency key for the level-up action
  user_id -> user (set null), nullable
  class text not null
  level int not null                 -- checked 1 to 5, matching the user columns
  source text not null               -- 'picker' (the /account faction picker) | 'volunteer' (the level-up action)
  awarded_by -> user (set null), nullable
  awarded_at timestamptz
  checks_passed boolean not null
  override_reason text null
  card_photo_url text null           -- optional record-card photo; https check constraint
  note text null
  voided_at, voided_by, void_reason
  partial unique (user_id, class, level) where voided_at is null and user_id is not null

quest_attempts                       -- optional, cycle one if cheap
  id, quest_id, entered_by, entered_answer text, correct boolean, at
```

Current levels: the `user` table's `wizard_level`, `pirate_level` and `alien_level` columns are the source of truth for a player's current level in each class. 0 means not in the class. Everyone starts at {0, 0, 0}. `level_events` is the audit log: it is what undo and the dashboard time series read. The volunteer level-up action writes a `level_events` row and then sets the column. The faction picker on `/account` also writes a `level_events` row (source `picker`) when it sets a class, so joins appear in the time series.

Undo of a level event voids it and then recomputes that class's column from the player's remaining non-voided events (the max `level`, through `deriveLevels` in `megagame-rules.ts`). If no event remains in that class, the column falls back to 1 if the player joined that class through the picker, else 0.

Levels are whole numbers from 1 to `MAX_LEVEL` (5, in `megagame-levels.ts`). A level above the maximum is refused, matching the check constraints on the user columns. Transition rule: a new level event must be strictly greater than the current level (checked in the action, not atomic across two simultaneous level-ups; corrections happen by voiding), and the tool warns when it is not current + 1, since the notes describe one unique experience per (class, level). All user-referencing columns are `text`, matching `user.id`.

Picker lock: once a player has any non-voided `level_events` row recorded by a volunteer (source `volunteer`), the picker on `/account` no longer works. The action refuses, and the panel shows the current levels instead. The picker is a pre-con tool and the volunteer process is during the con. Before the first volunteer level-up, the picker keeps its current behavior, including resetting the other classes to 0 when a player switches.

Requirements (soft checks) are a constant table in `megagame-rules.ts` in cycle one, keyed by (class, level): minimum completions in that class, plus a warning when a level is skipped. Shipping with the table empty is allowed. A UI-editable table is the follow-up if redeploying to tune proves too slow.

Concurrency and retries, given no transactions:

- Confirm: insert the `confirmations` row with its requested players (`on conflict do nothing`). If it already exists and is voided, return "voided" and insert nothing. Otherwise (new or a retry) run `insert ... on conflict do nothing returning` for all requested players at once, targeting the partial index. The result is built from the completion rows carrying this confirmation id: present means recorded, absent means already completed elsewhere. A crash between the two statements is repaired by the retry, since the second statement is idempotent.
- Level-up: `insert ... on conflict do nothing returning` on the event id and on the partial unique index, then set the user column; check evaluation before the insert is not atomic, which is acceptable for soft checks.
- Undo: voids the confirmation and its completions by confirmation id (`db.batch()` for the two updates). A retry of the original confirm after undo returns "voided", it does not re-insert.
- Level-event undo: void the event, then recompute the column as described above.

Code layout: `src/db/schema/megagame.ts`; `src/lib/megagame-rules.ts` (pure: code normalization reuse, answer normalization and matching, level derivation for undo, requirement evaluation, bucket math); `src/lib/megagame-store.ts` (queries, tested with the mocked DB); `src/app/backstage/megagame/{page,actions,layout}.tsx` plus `q/[code]`, `dashboard`, `quests`; `src/app/(v2)/q/[code]` and `/p/[code]`.

## 5. Flows

### 5.1 Verify a quest

1. Home: quest code `PinInput` (autofocus), the current player list (from the URL), recent confirmations by this volunteer with Undo, link to level-up. Phones: a Scan button when the scanner phase has landed.
2. Quest page (`/backstage/megagame/q/<code>`): title, class, lock window, active flag. Checker:
   - `answer`: a field to type what the players said, showing match / no match with a normalizer (case, whitespace, punctuation, accents). A "Reveal answers" tap shows the accepted list, so answers are not on screen by default at a crowded desk. The volunteer decides; the field is a helper and feeds `quest_attempts`.
   - `evidence`: the description shown outright. The volunteer judges.
3. Players: add by code, name search, or scan. Each row: name, pronouns, levels per class, and a status: OK / already completed (when, by whom; hard block, the user's stated rule) / outside the lock window (warning) / no claimed ticket (warning).
4. Confirm: one action, one `confirmations` row, completions for every OK player. Result screen lists what was recorded, with Undo. The result is reachable by reload because the confirmation id is in the URL.
5. Undo: the volunteer who made a confirmation may void it with a reason; `megagame.manage` holders may void any confirmation, or one player's completion out of a group, from the quest or player page. Every void is logged.

### 5.2 Level up

1. Pick player (same lookup), pick class; see current level per class (from the user columns); pick the new level (default current + 1). A level above 5 is refused.
2. The action lists failing checks in words ("Has 1 wizard quest; level 2 asks for 3", "Skips level 2"). With failures the button reads "Record anyway" and needs a "Yes, I'm sure" checkbox plus optional reason. No setting makes checks hard; zeroing the constant table turns them off.
3. Optional photo of the record card: browser-side downscale, Blob upload, `card_photo_url`. Never required.

### 5.3 Management

Cycle one: a CSV paste importer (code, title, class, kind, answers, evidence, hint, min/max level) and a read-only quest table with per-quest QR download, gated on `megagame.manage`. An inline editor only if staff need it during the con.

## 6. Dashboard

Gated on `megagame.verify`. Tables first, inline SVG bars for the few charts that matter, no charting dependency. Last phase, so it cannot block the tool.

1. Levels: class x level grid of players at each current level, read from the user columns; denominator is claimed ticket holders, labeled as such (there is no check-in data).
2. Quests: completions per quest, per class, distinct players with at least one completion, completions per volunteer.
3. Over time: completions and level-ups per class per bucket, bucket sizes 5m, 15m, 30m, 1h, 3h, 6h, 1d, range presets (last 2h, today, whole con). Computed with `date_bin` over a whitelist of intervals, filtered to non-voided. Con days are Pacific, so day buckets start at midnight Pacific standard time (UTC-8). A cumulative view gives the level distribution as of each bucket end.
4. Recent overrides and voids.
5. CSV export of the three event tables.

Page refreshes every 60 s.

## 7. Future data sources (placeholders only)

- Session rewards: `session_rewards(session_id, user_id null, count, recorded_by, at)` recorded by the shepherd or host from the session page in the schedule tool. Dashboard gets a tab when it exists.
- Card game: the optional record-card photo on the level event is the only hook. A structured `card_games` table can reference `level_events` later.

## 8. Risks and policies

- Connectivity: online only. Idempotent ids, result pages reachable by reload, a recent-confirmations list on the home page, and the player list in the URL cover timeouts. Volunteers must be signed in on their phone before the shift (email code sign-in is slow on bad wifi); this goes in the shift checklist.
- Camera needs HTTPS; previews and prod are fine.
- Retention: user deletion sets player and volunteer columns to null and keeps the rows, so event counts and time series do not change after a deletion; the "distinct players" figure counts all deleted users as one. The partial unique indexes exclude null user ids.
- Spoilers: answers only behind the verify permission and behind a reveal tap.
- Classless quests cannot carry a lock window (check constraint).

## 9. Phasing

1. Now, nothing in the DB: `megagame-rules.ts` with tests (matching, level derivation, requirement evaluation, bucket math); the two permission keys (harmless until granted, consistent with the file's "keys wait for their page" note). No placeholder tile in prod.
2. Schema stable: schema file, `pnpm db:generate`, describe.ts and its test, store module with mocked-DB tests.
3. Verification tool, level-up, `/q/` and `/p/` routes, QR download, CSV import, and the picker lock on `/account`. Phone-first; preview screenshots per CLAUDE.md.
4. Dashboard and export.
5. In-page scanner (move `jsqr` to dependencies), attempt logging.

## 10. Decisions settled with the user (2026-10-28)

- Badges will carry a code, a QR, or both; the `player_codes` table and `/p/<code>` route are in scope.
- Levels: 0 means not in the class; everyone starts at {0, 0, 0}; the 5-level chart in the notes is the reference.
- Two permission keys; anyone who can record confirmations can see the dashboard.
- `/q/<code>` redirects non-volunteers to their own account page.
- Undo: the confirming volunteer, plus `megagame.manage` for anything.
- Defaults taken without objection: lock windows warn rather than block; a deleted user's events are kept with the user column set to null; soft checks are code constants; the record-card photo is optional.

Settled on 2026-11-01:

- Current levels are the `user` level columns. Level-ups write a `level_events` row and then set the column. Undo recomputes the column from the remaining non-voided events, falling back to 1 for a picker join and 0 otherwise. The picker also writes a `level_events` row once phase 2 lands.
- The picker on `/account` stops working once a volunteer has recorded a non-voided level event for the player. This is a phase 3 change to the picker action.
- A level above 5 is refused rather than warned about. Dashboard day buckets start at midnight Pacific standard time.

## 11. Assumptions the design makes that the request did not state

Kept unless the user objects: quests have a class (nullable) and a lock window from the notes; codes are 6-char Crockford with the ticket normalizer; answer matching ignores case, whitespace, punctuation and accents, with several accepted answers per quest; attempt logging; group confirmations undo as a group; no offline mode; CSV import rather than an editor; dashboard extras (per-volunteer counts, overrides list, cumulative view, export, auto-refresh); session rewards recorded per session by the shepherd or host; the duplicate-completion rule has no override.

## 12. Revision 2026-11-03

The project owner reviewed the built tool and asked for one page. The volunteer tool is now a single page titled "Quest Board" at `/backstage/megagame`, gated on `megagame.verify`. In order, it shows the quest section (code entry and scanner, then the checker, player list, per-player status, confirmation and its result with undo), the level-up section, recent actions by every volunteer with undo where the viewer may undo, and the completions and level-ups chart over time. The quest, the player list, the confirmation id, the level-up player, the number of recent actions and the chart choices are all query parameters. `/q/<code>` sends a volunteer to the board with that quest open.

Dropped from the tool: the separate quest, level-up, quest management and dashboard pages, the quest CSV import form, the quest list with QR downloads, the CSV exports, the levels grid, the per-quest, per-volunteer and cumulative tables, and the separate list of recent overrides. Overrides now appear among the recent actions with their reason.

Quest import (expected to be a script) and an admin dashboard are later work. The store queries and the CSV parser they will need are kept. QR downloads for quest labels are also later work.
