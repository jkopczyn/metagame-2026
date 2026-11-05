// One-off: writes a `picker` level_events row for each player who joined a
// Megagame class on /account before the picker recorded events. Without it,
// undoing a volunteer level-up in that class would drop the player to 0, and
// the dashboard would not show the join. awarded_at is the run time, since the
// original join time was never stored.
//
// Only class columns at exactly 1 are backfilled, since the picker never set
// anything higher; columns above 1 with no events are listed for a person to
// look at. Safe to run twice: a class that already has a live event is skipped.
//
// Dry run by default. Pass --apply to write.
//
//   DATABASE_URL=... node scripts/backfill-megagame-picker-joins.mjs [--apply]
import { neon } from "@neondatabase/serverless";

try {
  process.loadEnvFile(".env.local");
} catch {
  // file absent
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const apply = process.argv.includes("--apply");
const sql = neon(url);

const missing = await sql`
  select p.user_id, c.class, c.level
  from profiles p
  cross join lateral (
    values ('wizard', p.wizard_level), ('pirate', p.pirate_level), ('alien', p.alien_level)
  ) as c(class, level)
  where c.level > 0
    and not exists (
      select 1 from level_events e
      where e.user_id = p.user_id and e.class = c.class and e.voided_at is null
    )
  order by p.user_id, c.class
`;

const joins = missing.filter((r) => r.level === 1);
const odd = missing.filter((r) => r.level !== 1);
console.log(`${joins.length} picker joins without an event`);
for (const r of odd) {
  console.log(
    `not backfilled: ${r.user_id} is level ${r.level} ${r.class} with no events`,
  );
}

if (!apply) {
  console.log("Dry run. Pass --apply to write the rows.");
  process.exit(0);
}

const written = await sql`
  insert into level_events (id, user_id, class, level, source, awarded_by, checks_passed, note)
  select gen_random_uuid(), p.user_id, c.class, 1, 'picker', p.user_id, true,
    'Backfilled: joined on /account before level events were recorded'
  from profiles p
  cross join lateral (
    values ('wizard', p.wizard_level), ('pirate', p.pirate_level), ('alien', p.alien_level)
  ) as c(class, level)
  where c.level = 1
    and not exists (
      select 1 from level_events e
      where e.user_id = p.user_id and e.class = c.class and e.voided_at is null
    )
  on conflict do nothing
  returning id
`;
console.log(`wrote ${written.length} picker events`);
