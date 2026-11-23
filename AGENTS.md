<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Worktrees

Always work in a worktree, never in this checkout directly, even for a one-line fix.
Use Claude Code's built-in worktree flow. `pnpm dev:local` runs the app there with
its own seeded database on a printed port, no credentials needed; without Resend
sign-in codes appear in its log.

## Code comments

Minimal. A short note for a non-obvious _why_ is fine; don't narrate the change
itself or let a comment grow into a PR report.

## Database

Neon Postgres via Drizzle. Schema is `src/db/schema/`, queries go through
`getDb()` in `src/db/index.ts`, and migrations are the SQL files in `drizzle/`.
After changing the schema run `pnpm db:generate` and commit what it writes;
never hand-edit a generated migration. Deploys apply migrations before the
code goes live (see the Vercel workflows). `/backstage/schema` iframes a Liam ERD
site that `next build` generates from the migrations into `public/schema-erd`;
`/backstage/schema/list` renders the same schema column-by-column from the Drizzle
objects. Airtable stays the ops view for
purchases and RFPs; Postgres is the source of truth for accounts, ticket
ownership, and the schedule.

Drizzle silently skips a migration whose journal `when` is older than the newest
applied one, so regenerate after rebasing rather than renumbering; `pnpm db:check`
(also run by CI and `db:migrate`) fails on that.

### Tickets

The payment webhooks write each purchase to `tickets` through `recordTicket()`
in `src/lib/ticket-store.ts`, upserting on the payment id so retries can't
duplicate, and then mirror it to Airtable; a mirror failure still sends the
emails, then returns a 500 so the provider's retry fills Airtable in; a retry
still stuck on Airtable skips the follow-up and the alert. Purchases from before that were backfilled from Airtable once (2026-10-20). A ticket is
owned only once its code is claimed; a matching purchaser email shows the
buyer their tickets but never grants ownership.

## Accounts

Better Auth, built lazily by `getAuth()` in `src/lib/auth.ts` over the Drizzle
client. `/login` signs in with an emailed six-digit code (which also creates the
account; one email per address per 30s, resends reuse the live code); `/account` holds the profile and an optional password. Accounts only
come from proving the email, so password sign-up is disabled and password
sign-in is refused on unverified accounts. `currentSession()` is the server-side
read; `src/proxy.ts` only redirects, so every protected page and action calls it
again.

Team tools (`/backstage/*`, `/grade`) each gate on a permission from the catalog
in `src/lib/permissions.ts`; `can(permission)` in `src/lib/access.ts` is the
one check, resolving roles (`/backstage/roles`) and per-user grants
(`/backstage/users/[id]`) per request. `user.role = 'admin'` (Better Auth's admin
plugin) bypasses it all and is only set by SQL or by another admin on
`/backstage/users`; the first admin is bootstrapped by hand in the Neon console:
`update "user" set role = 'admin' where email = '…'`. `toolAccess()` /
`requireAccess()` (`src/lib/admin-auth.ts`) wrap `can()` for `/backstage`.

The speaker committee works at `/backstage/speaker-committee`
(`schedule.manage`), which `/grade` redirects to; `/grade/<id>` is still the
rubric for one proposal, gated on `submissions.grade`.

## Looking at UI changes

For any substantive UI change, run `node scripts/preview-shot.mjs <preview-url>
/path [/path…]` against the PR's Vercel preview (URL in the bot comment) and
inspect the screenshots to see that things appear correct on mobile and
desktop (or against `pnpm dev:local`, as a fork PR gets no preview). It needs
`node_modules/playwright` plus a Chromium: the per-machine
one from `npx playwright install chromium-headless-shell`, or any Chromium on
the box via `SHOT_BROWSER=<path>`. If either is missing, ask before installing
and say it's for the screenshots. If anything is off,
surface the screenshots to the user for review rather than iterating on your
own. Delete the screenshots afterwards so they don't pile up.

## Issue tracking (Linear)

Work is tracked in Linear (Metagame team): attach PRs by putting `[META-###]` in the PR title or using the Linear-provided branch name, and file issues generously — including to record work already done. In the PR body only `Fixes META-###` attaches; avoid `Ref`, which blocks the on-merge status transitions. A linked PR moves the issue to In Progress on open and In Review on merge — In Review means "merged, pending human review", and nothing moves an issue to Done automatically, so never mark issues Done yourself. No Linear access? Skip all this — a clear PR description is enough.

When mentioning PRs or issues in your output, render them as links whenever possible — PR numbers as `https://github.com/tradingbootcamp/metagame-2026/pull/<num>` and Linear issue IDs as `https://linear.app/arbormetagame/issue/META-###`.
