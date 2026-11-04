# src/v2

Components, data and helpers for the public site; the routes are in `src/app/(v2)/`.
Server code, and the few modules both sides import, stay in `src/lib/`.

## Hero puzzle (`puzzle/`)

On load one of seven games is picked at random and its crop of the library
photo becomes the hero backdrop (`/images/puzzle/library_<game>.webp`). Each section divider is
one game (`components/dividers/*/index.tsx` passes `game=` to `DividerRow`).
A guess is pressing Enter while the pointer is over a divider — never a
click, so the dividers' own minigames are untouched. Enter over the current
game's row earns its star and picks a new game; over any other row it shakes
and wipes the stars. A star for all seven → `library_win.webp`. The dice row
is D&D (the sword/dragon `dnd` set is unmounted).

- `puzzle/boot.ts` — inline script in the layout that makes the pick before
  first paint, so only the chosen image loads.
- The images are committed in `public/images/puzzle/` as 2560px WebPs (`cwebp -q 70`).
  To change one, export the new photoshop at that size and name and drop it in.

## Stage (`stage/`) — parked

**Puzzle in progress, not mounted.** Nothing imports `stage/`, so none of it
ships; the comment in `src/app/(v2)/layout.tsx` says how to re-enable it.

A page-space physics layer: `Stage` wraps the layout and owns two full-document
overlays, `behind` and `sprites`, positioned in document pixels, the same space
the colliders use. DOM, not canvas, on purpose: hitboxes come straight from
layout, so wrapping, zoom, hover swells and FAQ expansions are consistent for
free. `solids.ts` decides what is solid; add `?stage=debug` to the URL to outline
every collider.
