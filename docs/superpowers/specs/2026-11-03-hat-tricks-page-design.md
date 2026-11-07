# Hat Tricks page: design

> Since this was written, the schedule moved from the `HAT_TRICKS_SCHEDULE` environment variable to the `hat_schedule` table, and steals and the schedule are edited at `/backstage/hat-tricks`.

Date: 2026-11-03. Status: approved by the user in discussion; ready for an implementation plan.

## What the game is

Hat Tricks is an in-person minigame at Metagame 2026. Six physical hats are handed out early. At any moment some of the hats are "on shift", meaning they may be stolen (by guile, never force) from whoever holds them. A steal is recorded by a volunteer; that write path is deferred and is not part of this work. Scores are announced at the end, with a medal per hat and one overall.

This is unrelated to the existing website easter egg in `src/v2/hat-trick/` (hats hidden in photos, stored in localStorage). Do not touch that code and do not reuse its store. The new code goes in its own module directory (suggested: `src/v2/hat-tricks/` plus `src/lib/hat-tricks*.ts` for server logic) so the two are not confused.

## Secrecy constraint

The repository is public and attendees read it looking for puzzle hints. The shift schedule (which hats are on shift when, and the shift lengths) must not be in the repository: not in code, not in migrations, not in seeds, not in tests except as clearly made-up fixtures, not in `.env.example` except as a fake example. The schedule is supplied only through an environment variable set in Vercel.

The browser must never receive the schedule beyond what the page shows: the hats on shift now, when the current shift ends, and when the following shift ends. In particular, which hats are on the next shift is never sent. Points are computed server-side from shift changes that have already happened.

The user's rules document (`Hat Tricks - Metagame_LessOnline minigame.md` in the worktree root) is untracked and listed in `.git/info/exclude`. It must never be committed. Only the four rules and their detail paragraphs (reproduced below) go into the code.

## Hats

Six hats, in this order, with these ids and display names:

| id        | name              | art source (in `~/Documents/metagame/hat-trick-medals/`) |
| --------- | ----------------- | -------------------------------------------------------- |
| `wizard`  | Wizard hat        | `01_wizard_art.svg`                                      |
| `saucer`  | Alien saucer      | `02_ufo_art.svg`                                         |
| `fuzzy`   | Sparkly fuzzy hat | `04_sparkly_fuzzy_art.svg`                               |
| `slouch`  | Satin slouch hat  | `05_satin_slouch_art.svg`                                |
| `tricorn` | Tricorn           | `06_tricorn_art.svg`                                     |
| `crown`   | Spiked crown      | `07_spiked_crown_art.svg`                                |

The striped beanie (`03_*`) is not used. `08_hat_stack_all_six.svg` is the page header image.

Copy the SVGs into `public/images/hat-tricks/` (names `wizard.svg`, `saucer.svg`, `fuzzy.svg`, `slouch.svg`, `tricorn.svg`, `crown.svg`, `stack.svg`). In each copy remove the white background `<rect>` and the red `<circle>` so the art is a transparent black line drawing; keep the `viewBox` and the `<g id="art">` contents unchanged. The source files are under the user's home directory, not in the repo; copying them in is part of the work.

Each hat has a photo slot. No photos of the physical hats exist yet. The hat definition has an optional `photo` field; when it is absent the page shows the SVG in the photo slot too. Adding photos later means dropping files into `public/images/hat-tricks/` and filling the field.

## Schedule

Environment variable `HAT_TRICKS_SCHEDULE`, read server-side through `env` in `src/env.ts` (add it there, not required, with a description; add a fake entry to `.env.example`). Value: JSON, an array of shifts in chronological order:

```json
[
  {
    "start": "2020-01-01T10:00:00-08:00",
    "end": "2020-01-01T11:00:00-08:00",
    "hats": ["wizard"]
  },
  {
    "start": "2020-01-01T11:00:00-08:00",
    "end": "2020-01-01T12:40:00-08:00",
    "hats": ["crown", "fuzzy"]
  }
]
```

Rules for the value:

- `start` and `end` are ISO 8601 timestamps with an offset. `end` is exclusive. (The example above is fake. Examples and fixtures in the repo must use 2020 dates and must not be the real schedule; a decoy weekend shape is fine, for example 4-hour shifts Friday, 2-hour Saturday, 20-minute Sunday, with long overnight shifts.)
- `hats` is a non-empty array of hat ids; at most two per shift.
- Shifts are contiguous: each one starts at the instant the previous one ends. A gap or an overlap between consecutive shifts is rejected, so between the first start and the last end every instant is inside a shift.
- The schedule must cover the whole event, including past shifts, because scoring reads past shift changes from it. Editing a past entry changes past scores; that is intended.

Parsing is strict: a malformed value or an unknown hat id throws at parse time with a message naming the problem. The page then renders its error state (see below) rather than crashing the whole site. An unset variable is treated as an empty schedule.

Server logic (pure functions, unit-tested with made-up schedules):

- `currentShift(schedule, now)`: the shift containing `now`, or none.
- `nextShift(schedule, now)`: the first shift starting at or after `now` (used when outside any shift).
- The page's "shift state" for `now`: either `{ kind: "on", hats, endsAt, next }` (where `next` describes the shift after the current one as `{ startsAt, endsAt }`, or is absent if there is none), `{ kind: "off", nextStartsAt }` (between shifts, or before the first), `{ kind: "done" }` (after the last shift's end), or `{ kind: "standing", hats: ["tricorn"] }` (schedule unset, empty, or unparseable: the pirate tricorn is the only hat and is stealable the whole time).
- `shiftChangesBetween(schedule, from, to)`: the ordered list of shift-change instants in `(from, to]`. A shift change is any shift `start` or `end` (a shift's `end` that equals the next shift's `start` is one change, not two). This is what scoring iterates.

The schedule is read per request; there is no caching beyond that, so a change in Vercel takes effect on the next request after redeploy or env reload.

## Steals

New table `hat_steals` in `src/db/schema/hat-tricks.ts` (exported from the schema index), migration generated by `pnpm db:generate` and committed:

| column       | type                                          | notes                                                            |
| ------------ | --------------------------------------------- | ---------------------------------------------------------------- |
| `id`         | uuid, pk, default random                      |                                                                  |
| `hatId`      | text, not null                                | one of the six ids; checked by a `check` constraint listing them |
| `userId`     | text, not null, fk user.id on delete cascade  | the thief                                                        |
| `stolenAt`   | timestamptz, not null, default now            |                                                                  |
| `recordedBy` | text, nullable, fk user.id on delete set null | the volunteer; null for backfills                                |
| `createdAt`  | timestamptz, not null, default now            |                                                                  |

Index on `(hatId, stolenAt)`.

No write path in this work. Tests seed rows directly.

## Scoring

Computed on each request from all `hat_steals` rows plus the schedule, with `now` as the cutoff. Definitions, per hat:

- Order that hat's steals by `stolenAt`. The holder from steal _k_ until steal _k+1_ (or until `now`) is steal _k_'s `userId`. Before the first steal nobody holds the hat (the starting volunteer holders score nothing).
- **Theft points:** each steal gives its thief 5 points, at `stolenAt`.
- **Holding points:** for each holding interval `[stolenAt_k, stolenAt_{k+1} or now)`, take the shift changes in that interval (using `shiftChangesBetween`, with `now` as the upper bound for the last interval). The _n_-th change in the interval (1-based) gives the holder `2n - 1` points: 1, 3, 5, 7, ... The streak restarts at every change of holder. A hat held through a change scores whether or not that hat is on shift at the time.
- A hat change exactly at a shift change: the steal is at `stolenAt`; the change at instant `t` counts for whoever holds the hat at `t`, i.e. the interval is closed at its start and open at its end, and `shiftChangesBetween(from, to)` is open at `from` and closed at `to`. So a steal recorded at the same instant as a change gives the change to the new holder. Tests pin this down.

Per-user totals:

- `steals`: number of steals by the user (overall, or for one hat).
- `points`: theft points plus holding points (overall, or for one hat).

Leaderboard ordering: points descending, then steals descending, then display name ascending. Users with zero steals do not appear.

Scoring functions are pure (`scoreHats(schedule, steals, now)` or similar) and unit-tested with made-up schedules and steal lists, including: no steals; one steal and no changes; one steal across three changes (1+3+5); a steal back resetting the streak; a steal at the instant of a change; two hats held by one user summing in the overall table and separate in the per-hat tables.

## Page

Route: `src/app/(v2)/hat-tricks/page.tsx`. Public; no sign-in. Server component with `dynamic = "force-dynamic"` (it reads the clock and the database on each request). Uses the v2 site shell and styles like the other `(v2)` pages. Metadata title "Hat Tricks — Metagame 2026".

Sections, top to bottom:

1. **Header.** The six-hat stack SVG, the title "Hat Tricks", the one-line tagline "A hat trick is when you trick someone and take their hat."
2. **On shift now.** One card per on-shift hat (one or two): the hat's SVG, its photo (or the SVG again), its name, and "Last stolen by {display name}" with the time, or "Not stolen yet" if the hat has no steal rows. When the state is `off`: "No hats can be stolen right now. Next shift starts at {time}." When `done`: "The game is over." When the schedule failed to parse, is unset, or is an empty list, the state is `standing`: the pirate tricorn card is shown as if on shift, with no end time, followed by "No shift schedule is posted, so this hat can be stolen at any time." and no error details.
3. **Clock.** Current event-local time (Pacific, `America/Los_Angeles`, using the `PACIFIC` constant from `src/lib/schedule.ts`), ticking each second in a small client component seeded with the server time so there is no hydration mismatch (render the server time, then start ticking on mount). Below it: "This shift ends at {endsAt}", then, when a following shift exists: "The shift after that ends at {next.endsAt}" if it starts when this one ends, or "The next shift runs {next.startsAt} to {next.endsAt}" if there is a gap first. Times are shown as weekday plus 12-hour time, for example "Sat 3:45 PM". The client component receives only the instants to display, never the schedule.
4. **Leaderboards.** One table "Overall" (all six hats) and one table per on-shift hat, titled with the hat's name. In the `done` state, all six per-hat tables are shown instead, since the game awards a medal per hat and nothing remains to hide. Columns: rank, display name, steals, points. Empty tables show "No steals yet."
5. **Rules.** Four expandable items (native `<details>` elements, closed by default, all independently openable). Summary line is the rule title; body is the detail paragraph. Text:
   1. **Honor among thieves.** This game is opt-in and more dangerous than other games. It is not possible to police these rules perfectly without constant surveillance, so the honor system for self-reports and rule violations is necessary. If you won't, can't, or don't want to adhere to this, do not accept or steal a hat, and hand off any hats you stumble on to another team member or volunteer as soon as possible. Do not involve players without making sure they understand this and opt in, and don't involve young children.
   2. **Wear your hats.** While in public areas, all hats in your custody must be worn, whether or not they may be stolen currently. If one of your hats can be stolen but there are others on top of it, those can be stolen at the same time. Bedrooms and bathrooms are not public. If you invite someone into a private area with you, it's public for them until they leave. If you're observed breaking this rule, you forfeit the hat(s) and the observer gets them.
   3. **Guile, not might.** No punching, kicking, grappling, wrestling, etc. allowed. Parrying incoming grabby hands is allowed; immobilizing one hand to prevent a second from grabbing is borderline. If you break this rule, you'll lose credit for the steal, have to give it back, and, if it was egregious or you've been warned, be banned from the game. If not from the conference.
   4. **Watch the clocks.** Not all hats may be stolen at all times. This page shows the currently stealable hats and when the shift changes. Stealing a hat outside this window, except by salvage of an abandoned hat, will be punished by reversal and a penalty. That includes bribery and extortion; if you want that, make the trade during a stealing window.

   The age line in rule 1 is deliberately left as "young children"; the user has not settled an age.

The page does not show: which hats are on the next shift, how many hats are on the next shift, or anything about scoring beyond the two leaderboard columns. Add a short scoring line under the leaderboards: "5 points per theft, plus points for every shift change you hold a hat through: 1, then 3, then 5, and so on."

Display names come from `user.name`. Every user with at least one steal appears; there is no opt-in.

## Error handling

- Schedule unset or unparseable: the page renders the standing tricorn state; the parse error is logged server-side. The leaderboards still render using whatever steals exist, with holding points of zero (no changes known) and theft points counted.
- Database unavailable: let the existing error boundary handle it, as other pages do.

## Testing

- Unit tests (vitest) for schedule parsing (valid, malformed JSON, unknown hat, overlapping shifts, more than two hats, empty), shift state at various instants (inside, before first, after last, at an exact boundary), `shiftChangesBetween`, and scoring as listed above.
- A rendering test is not required; verify the page with the preview screenshot script against the Vercel preview, on mobile and desktop, per the repo CLAUDE.md.
- Tests use fake schedules on 2020 dates. A decoy weekend shape (shortening shifts, long nights, two-hat shifts) is encouraged as long as it is not the real schedule.

## Out of scope

Recording steals (volunteer tool), admin editing of the schedule, night-shift display differences, per-team scores, Discord or TV display modes, photos of the hats.
