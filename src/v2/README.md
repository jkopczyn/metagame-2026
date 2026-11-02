# src/v2 — the site rewrite

Everything the new site renders lives here; the routes are in `src/app/(v2)/`.
The previous one-pager is untouched at `src/app/legacy/` (served at `/legacy`) and
its components still live in `src/components/`, `src/lib/`, `src/data/` — pull
things over from there as they're wanted, copying (not importing) so this folder
stays self-contained and the old tree can eventually be deleted.

Routes: `/` (one-pager, tickets at `/#tickets`), `/last-year`, `/get-involved`, `/sponsor`,
`/childcare`, `/team` (cards from `data/team.ts`). External links live in `lib/links.ts`; `TODO(team)` marks
placeholders. Content pages use `components/ContentPage.tsx` for the shared
title block and nav clearance. The corner nav links to pages
(`components/nav/links.ts`); the active page's icon shows on the die.

Pulled over so far:

- `components/nav/` — the corner-die nav (`ExpandingNav`, `LogoDice`,
  `Mg2Die`, `links.ts`, `useMediaQuery`).
- `components/dice/` — the above-the-fold 3D dice wordmark (`Dice` + `dice3d/`).
  The dev-only take curation panel is included but switched off
  (`DICE_EDITOR` in `Dice.tsx`); when on, `/api/dev/keep-take` writes to this
  copy's `takes/` folder. `/backstage/dice-lab` (`src/app/backstage/dice-lab/`) renders
  the same die (`DieBody`) on a transparent canvas for rolling, arranging and
  exporting PNG assets (shirts, print).
- `lib/dice-letter-paths.ts` — letter outlines shared by both of the above.
- `components/tickets/` + `lib/tickets.ts`, `lib/currency-store.ts` — the
  Stripe/BTC ticket panel and modals (the API routes they call stay in
  `src/app/api/`).
- `components/signup/` + `lib/interests.ts` — mailing-list form + follow-up.
- `components/schedule/` + `lib/last-year-schedule.ts`, `lib/schedule-styles.ts`,
  `data/last-year-schedule.json` — the 2025 schedule grid/list.
- `components/ui/` — shadcn button / dialog / input; `components/styles.ts`,
  `SectionHeading`, `FaqItem`, `SiteFooter`, `ChessDivider`.
- New here: `HeroBackdrop` (library photo + wash), `Carousel` (scroll-snap
  photo strip; images in `data/carousel.ts`), `ContentPage`.

To add a page to the nav: add an entry to `components/nav/links.ts`.

## Hero puzzle (`puzzle/`)

On load one of seven games is picked at random and its crop of the library
photo becomes the hero backdrop (`/images/puzzle/library_<game>.webp`). Each section divider is
one game (`components/dividers/*/index.tsx` passes `game=` to `DividerRow`).
A guess is pressing Enter while the pointer is over a divider — never a
click, so the dividers' own minigames are untouched. Enter over the current
game's row earns its star and picks a new game; over any other row it shakes
and wipes the stars. A star for all seven → `library_win.webp`. The dice row
is D&D (the sword/dragon `dnd` set is unmounted).

- `puzzle/store.ts` — in-memory state (a reload re-rolls), `guess()`, and
  `applyGame()` which sets the `--puzzle-image` CSS variable `HeroBackdrop`
  reads.
- `puzzle/boot.ts` — inline script in the layout that makes the pick before
  first paint, so only the chosen image loads. Falls back to catan.
- The images are committed in `public/images/puzzle/` as 2560px WebPs (`cwebp -q 70`)
  (`library_<game>.webp` for chess, cards, set, dnd, botct, catan, monopoly,
  plus `library_win.webp`). To change one, export the new photoshop at that
  size and name and drop it in.

## Stage: sprites, easter eggs, physics (`stage/`) — parked

**Puzzle in progress, not mounted.** Nothing imports `stage/`, so none of it
ships; the layout comment says how to re-enable it.

The page is a game board. `Stage` wraps the whole layout and owns two
full-document overlay layers — `behind` (under the content, for things that
pop out from behind a panel) and `sprites` (over it). Everything in them is
positioned in **document pixels**, the same space the physics colliders use, so
a sprite's `translate()` and a paragraph's line boxes always agree. DOM, not
canvas, on purpose: hitboxes come straight from layout, so wrapping, zoom,
hover swells and FAQ expansions are consistent for free.

- `physics.ts` — pure Verlet rigid square + axis-aligned rect colliders. No DOM.
- `solids.ts` — decides what is solid. One rule list (`SOLID_RULES`) by
  selector; headings/paragraphs/list items are `text` (one collider per
  rendered line), buttons/links/images/footer are `box`. Override on any
  element with `data-solid="box" | "text" | "none"`; `none` also prunes the
  subtree. Fixed UI (the corner nav) carries `none`.
- `useSolids.ts` — keeps the collider snapshot fresh: rescans on resize,
  DOM mutation, and size changes of solid elements, and bumps a `version`
  only when geometry actually changed (sprites wake on it).
- `ScrollDie.tsx` — the resident die. Rests on the footer, feels the page
  scroll as a pseudo-force (scroll fast and stop → it hops), lands on text
  lines, falls when a platform re-wraps away. Click flicks it. Knobs at the
  top of the file (`SCROLL_GAIN`, gravity in `DEFAULT_MATERIAL`).
- `StageDebug.tsx` — add `?stage=debug` to the URL to outline every collider.

To add a sprite: make a client component, mount it in the layout's
`sprites` (or `behind`) prop, read `useStage().solids.current` for colliders
if it needs them, and position it with `pageRect(el)` from `solids.ts` when it
should anchor to a piece of the page. Sprites are `pointer-events: none` by
default; opt back in on the element that wants clicks.
