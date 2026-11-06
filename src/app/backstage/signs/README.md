# Sign maker

A self-contained canvas page for print-ready event signs, framed at
`/backstage/signs` behind `misc.signs`. It is plain HTML + JS, not a React
page: the source is `assets/signs/template.html`, and
`python3 assets/signs/build.py` inlines the fonts and logos from
`assets/signs/assets/` into `assets/signs/metagame-signs.html`, which
`./app/route.ts` serves. Commit both the template and the built file.

The page works standalone (double-click the built file) with browser-local
autosave. When it loads under `/backstage/signs` it also talks to
`./api/route.ts` for shared drafts (the `sign_drafts` table) and uploads
photos and font files to Vercel Blob instead of embedding them.
