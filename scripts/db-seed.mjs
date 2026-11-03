// Fills a dev database with deterministic fake data, so previews never hold
// real accounts, sessions, or purchases. Everything upserts on fixed ids, so
// re-running is a no-op; a prune step first removes seed rows the script no
// longer produces. Refuses to run without --yes or against the production
// endpoint.
//
// The usual way to run it is `pnpm db:reset --yes` (or the "Reset dev DB"
// workflow), which drops the schema, replays the migrations and then seeds.
// Against a brand-new schema-only Neon branch, seed before migrating:
//   DATABASE_URL=<its connection string> pnpm db:seed --yes && pnpm db:migrate
//
// Seed before migrating: a schema-only branch copies the tables but not the
// migration ledger, so db:migrate would replay 0000 and fail. When the ledger
// is empty this script fills it from drizzle/meta/_journal.json, which is right
// only when the checkout's migrations match what the parent branch has applied
// (run it from origin/main).
//
// Every account with a password signs in with "metagame":
//   admin@metagame.games       role admin (superuser bypass)
//   grants@metagame.games      per-user grants: tickets.view, links.manage
//   host@metagame.games        "Team" and "Schedule team" roles; lead host of
//                              three published sessions; level 1 Pirate
//   team@metagame.games        "Team" role only; claimed comp ticket
//   schedule@metagame.games    "Schedule team" role only; claimed comp ticket
//   attendee@metagame.games    claimed ticket (so the built-in Attendee role),
//                              RSVPs, bookmarks; level 5 Wizard, level 3 Alien
//   newcomer@metagame.games    unclaimed purchase under their email
//   banned@metagame.games      banned
//   first.last@metagame.games  a crowd of 100 in the mix the invite flow makes:
//                              60 ticketed, 20 signed in with no ticket, 10
//                              invited (hosts, team, one admin) who never signed
//                              in, 10 who bought under an email with no account
//   speaker-<key>@metagame.games
//                              the homepage's featured speakers, with the ids
//                              and names in src/v2/data/speaker-accounts.ts
//                              (placeholder TODO ids skipped), each co-hosting
//                              one to three published sessions
// Plus 60 purchases from people with no account at all, and one API key for
// admin: x-api-key mg_seed_metabot_000000000000000000000000000000000000000000000000000.
//
// Not seeded: promo codes and tracking links live in Stripe and Airtable,
// not Postgres; sessions (the auth kind) are minted by signing in.
import { createHash, scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { SPEAKER_ACCOUNTS } from "../src/v2/data/speaker-accounts.ts";

for (const file of [
  ".env.local",
  ".vercel/.env.production.local",
  ".vercel/.env.preview.local",
]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // file absent
  }
}

// Compute endpoint of the Neon `main` branch (prod).
const PROD_ENDPOINT = "ep-crimson-sky-b8tcqhxv";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("[db:seed] DATABASE_URL not set — nothing to seed");
  process.exit(0);
}
const host = new URL(url).hostname;
if (host.startsWith(PROD_ENDPOINT)) {
  console.error(`[db:seed] refusing to seed the production endpoint (${host})`);
  process.exit(1);
}
if (!process.argv.includes("--yes")) {
  console.error(
    `[db:seed] would seed ${host}; pass --yes to confirm (this writes rows)`,
  );
  process.exit(1);
}

const sql = neon(url);

// Matches better-auth's scrypt settings (src/lib/auth.ts leaves the default
// hasher). Fixed salt keeps the hash, and so the upsert, deterministic.
const PASSWORD = "metagame";
const SALT = "5eed5eed5eed5eed5eed5eed5eed5eed";
const passwordHash =
  SALT +
  ":" +
  scryptSync(PASSWORD.normalize("NFKC"), SALT, 64, {
    N: 16384,
    r: 16,
    p: 1,
    maxmem: 128 * 16384 * 16 * 2,
  }).toString("hex");

// Same derivation as src/lib/ticket-code.ts.
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function ticketCode(paymentId) {
  const hash = createHash("sha256").update(paymentId).digest();
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[hash[i] % 32];
  return code;
}

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// Pacific time on the event weekend.
const at = (day, hour, minutes = 0) =>
  new Date(Date.UTC(2026, 10, day, hour + 8, minutes)).toISOString();

// Array params as a literal, so they survive any driver's serialisation.
const pgArray = (xs) =>
  `{${xs.map((x) => `"${x.replace(/["\\]/g, "\\$&")}"`).join(",")}}`;

/** Insert rows, updating every non-key column on conflict. */
async function upsert(table, keys, rows) {
  for (const row of rows) {
    const cols = Object.keys(row);
    const update = cols
      .filter((c) => !keys.includes(c))
      .map((c) => `"${c}" = excluded."${c}"`);
    await sql.query(
      `insert into "${table}" (${cols.map((c) => `"${c}"`).join(", ")})
       values (${cols.map((_, i) => `$${i + 1}`).join(", ")})
       on conflict (${keys.map((k) => `"${k}"`).join(", ")})
       ${update.length ? `do update set ${update.join(", ")}` : "do nothing"}`,
      Object.values(row),
    );
  }
  return rows.length;
}

// rsvps has a BEFORE INSERT capacity trigger that fires ahead of conflict
// resolution, so a plain upsert fails on a full session once rows exist.
async function upsertRsvps(rows) {
  for (const { session_id, user_id, status } of rows) {
    await sql.query(
      `insert into rsvps (session_id, user_id, status)
       select $1::uuid, $2::text, $3::rsvp_status
       where not exists (
         select 1 from rsvps where session_id = $1 and user_id = $2
       )`,
      [session_id, user_id, status],
    );
    await sql.query(
      `update rsvps set status = $3
       where session_id = $1 and user_id = $2 and status <> $3`,
      [session_id, user_id, status],
    );
  }
  return rows.length;
}

async function seedMigrationLedger() {
  const [{ n }] = await sql.query(
    "select count(*)::int as n from drizzle.__drizzle_migrations",
  );
  if (n > 0) return 0;
  const { entries } = JSON.parse(readFileSync("drizzle/meta/_journal.json"));
  for (const { tag, when } of entries) {
    const hash = createHash("sha256")
      .update(readFileSync(`drizzle/${tag}.sql`))
      .digest("hex");
    await sql.query(
      "insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)",
      [hash, when],
    );
  }
  return entries.length;
}

const users = {
  admin: { id: "seed-admin", name: "Seed Admin", role: "admin" },
  grants: { id: "seed-grants", name: "Seed Grants" },
  host: { id: "seed-host", name: "Seed Host", levels: { pirate: 1 } },
  team: { id: "seed-team", name: "Seed Team" },
  schedule: { id: "seed-schedule", name: "Seed Schedule" },
  attendee: {
    id: "seed-attendee",
    name: "Seed Attendee",
    levels: { wizard: 5, alien: 3 },
  },
  newcomer: { id: "seed-newcomer", name: "Seed Newcomer" },
  banned: {
    id: "seed-banned",
    name: "Seed Banned",
    banned: true,
    ban_reason: "seed data",
  },
};

const FIRST =
  `Ada Bashir Chiara Dmitri Esperanza Farid Greta Hiro Imani Jules Kalinda
   Leopold Maeve Nikolai Oona Priya Quentin Rosalind Soren Tamsin Umar Vesna
   Wendell Xiomara Yusuf Zelda Anouk Benedikt Cosima Desmond Eilidh Fergus
   Giulia Hamza Ingrid Jericho Kenji Liesl Marisol Nadia Olamide Pilar Quinlan
   Rafael Sunniva Tobias Ulla Viggo Wren Xavier Yara Zoltan Amara Bruno Celeste
   Dagny Emeka Fenna Gideon Halima Isidore Jolanta Kwame Lorcan Mireille Nestor
   Ottoline Paavo Qadir Rhiannon Sigrid Thaddeus Ulysses Valentina Wilhelm
   Xenia Yevgenia Zachariah Aurelio Beatrix Caspian Delphine Ezra Freya Gustavo
   Henrietta Idris Jasmine Kofi Lucinda Matthias Noor Octavia Percival Quilla
   Ravi Saoirse Tendai Ulrike Vivienne`.split(/\s+/);
const LAST =
  `Abernathy Baptiste Castellanos Delacroix Eriksen Fairweather Galloway
   Hashimoto Ibarra Jankowski Kowalczyk Lindqvist Marchetti Nakamura Okonkwo
   Pemberton Quiroga Rasmussen Sandoval Thackeray Underwood Villanueva
   Whitcombe Xiang Yamamoto Zielinski Ashworth Brannigan Cavendish Dubois
   Ellsworth Fitzgerald Grimaldi Holloway Ishikawa Jorgensen Kavanagh Lombardi
   Mbeki Nightingale Oyelaran Petrova Quennell Radcliffe Sorensen Takahashi
   Ueda Vasquez Winterbourne Xu Yilmaz Zamora Achterberg Bergstrom Cordeiro
   Dalgaard Esposito Ferreira Gutierrez Haddad Iyer Jansen Kristiansen Larsson
   Mendoza Novak Olofsson Pascal Quintero Rivera Schreiber Tanaka Uribe Varga
   Wakefield Xenakis Yoshida Zuniga Adeyemi Blackwood Chaudhary Dunmore
   Engelbrecht Falk Goldschmidt Havili Ivanova Joshi Kaur Leclerc Maalouf Nwosu
   Ortega Pinheiro Qureshi Rutherford Sato Tremblay Ulloa Vance`.split(/\s+/);
if (FIRST.length !== 100 || LAST.length !== 100) {
  throw new Error(`name lists: ${FIRST.length} first, ${LAST.length} last`);
}
const person = (first, last) => ({
  name: `${first} ${last}`,
  email: `${first}.${last}@metagame.games`.toLowerCase(),
});

// The crowd, in the mix the invite flow produces: most signed in and bought
// a ticket; some signed in and never bought; some were invited (as hosts or
// team) and never signed in; some bought under an email with no account yet.
// prettier-ignore
const KINDS = [
  ...Array(6).fill("attendee"),
  "member",
  "member",
  "invited",
  "buyer",
];
const crowd = Array.from({ length: 100 }, (_, i) => {
  const kind = KINDS[i % 10];
  return {
    id: `seed-${FIRST[i]}-${LAST[(i * 37) % 100]}`.toLowerCase(),
    ...person(FIRST[i], LAST[(i * 37) % 100]),
    kind,
    verified: kind === "attendee" || kind === "member",
    role: [11, 33, 18].includes(i) ? "admin" : undefined,
    i,
  };
});
const invited = crowd.filter((u) => u.kind === "invited");
// The featured speakers, under the account ids the homepage cards look up.
const SPEAKER_EMAIL = "speaker-%@metagame.games";
const speakers = Object.entries(SPEAKER_ACCOUNTS)
  .filter(([, { userId }]) => !userId.startsWith("TODO"))
  .map(([key, { name, userId }], i) => ({
    id: userId,
    name,
    email: SPEAKER_EMAIL.replace("%", key.toLowerCase()),
    verified: true,
    i: 200 + i,
  }));
const everyone = [
  ...Object.values(users).map((u) => ({
    ...u,
    email: `${u.id.replace("seed-", "")}@metagame.games`,
    verified: true,
  })),
  ...crowd,
  ...speakers,
];
// Bought a ticket, never made an account: most purchasers, early on.
const ghosts = Array.from({ length: 60 }, (_, i) => ({
  ...person(FIRST[i], LAST[(i * 53 + 7) % 100]),
  i,
}));

const PRONOUNS = ["she/her", "He/Him", "they/them", "he", "He/They"];
const profile = (u) => {
  const i = u.i ?? 1;
  const handle = u.email.split("@")[0].replace(".", "_");
  return {
    user_id: u.id,
    pronouns:
      u === users.host ? "they/them" : i % 7 === 3 ? PRONOUNS[i % 5] : null,
    discord_handle:
      u === users.attendee ? "seed_attendee" : i % 5 === 4 ? null : handle,
    bio:
      u === users.host
        ? "Runs games. Seeded."
        : i % 10 === 6
          ? `${u.name.split(" ")[0]} plays everything once and most things twice.`
          : null,
    is_public: u === users.host || (u.verified && i % 5 === 0),
    website:
      i % 9 === 2
        ? `https://${u.name.split(" ")[1].toLowerCase()}.example`
        : null,
    // Only set by the ticket-claim flow, so only claimed attendees have them.
    is_adult: u.kind === "attendee" || u === users.attendee ? true : null,
    bringing_children: u.kind === "attendee" ? i % 8 === 1 : null,
    share_with_recruiters: u.kind === "attendee" ? i % 3 === 0 : null,
  };
};

// Lighthaven's rooms, as the schedule shows them, with prod's visibility: the
// hidden ones are team-only there too and stay for placement. Images are
// Vercel Blob URLs in prod, null here.
// prettier-ignore
const ROOMS = [
  ["foodtruck", "Food Truck Parking", null, "Behind E", 0, "hidden"],
  ["ratpark", "Rat Park", 300, "Outdoors, behind B", 1],
  ["eigen", "Eigen Hall", 40, "Building E, 1st floor", 2],
  ["cantor", "Cantor's Diagonal", 60, "Building C", 3],
  ["glass", "Glass Hall", 35, "Building A, 1st floor", 4],
  ["courtyard", "Central Courtyard", 200, "The center of campus", 5],
  ["thingspace", "Thingspace", 20, "Building A, 2nd floor", 6],
  ["attic", "Bayes Attic", 35, "Building B, top floor", 8],
  ["gardens", "The Gardens", 80, "Outdoors, behind E", 9, "hidden"],
  ["ground", "Bayes Ground", 40, "Building B, 1st floor", 11],
  ["exobrain", "Exobrain", 30, "Building E, 2nd floor", 12, "hidden"],
  ["d2", "1D2", null, "Building D, 1st floor", 13, "hidden"],
  ["caprica", "New Caprica", null, "Building B, 2nd floor", 14, "hidden"],
  ["d1", "1D1", 6, "Building D, 1st floor", 100, "hidden"],
  ["gyroscope", "Gyroscope", 30, "Building E, 2nd floor", 100, "hidden", false],
  ["other", "Other", null, null, 100, "hidden", false],
  ["questboard", "Quest Board", null, null, 100, "volunteer", false],
];
const locations = Object.fromEntries(
  ROOMS.map(
    (
      [
        key,
        name,
        capacity,
        campus_location,
        display_order,
        visibility = "public",
        synced = true,
      ],
      k,
    ) => [
      key,
      {
        id: uuid(k + 1),
        name,
        capacity,
        campus_location,
        display_order,
        visibility,
        airtable_record_id: synced
          ? `recSEEDLOC${String(k + 1).padStart(7, "0")}`
          : null,
      },
    ],
  ),
);
// On a branch that already has rooms (a copy of prod), reuse them by name
// rather than adding a second "Rat Park"; those rows are left as they are.
const reusedRooms = new Set();
for (const { id, name } of await sql.query(
  `select id, name from locations where name = any($1::text[])`,
  [pgArray(ROOMS.map((r) => r[1]))],
)) {
  const room = Object.values(locations).find((l) => l.name === name);
  room.id = id;
  reusedRooms.add(room);
}
const slugify = (title) =>
  `seed-${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;

// Hand-made sessions that the named users and the grade below refer to.
const handmade = [
  {
    id: uuid(101),
    slug: "seed-opening-keynote",
    title: "Opening Keynote",
    description: "How to lose gracefully at everything.",
    category: "talk",
    starts_at: at(6, 10),
    ends_at: at(6, 11),
    location_id: locations.courtyard.id,
    max_capacity: 80,
    ages: "all",
    status: "published",
    phase: "ready",
    verdict: "confirmed",
  },
  {
    id: uuid(102),
    slug: "seed-puzzle-workshop",
    title: "Puzzle Construction Workshop",
    description: "Bring a pencil.",
    category: "workshop",
    starts_at: at(6, 13),
    ends_at: at(6, 15),
    location_id: locations.thingspace.id,
    max_capacity: 20,
    min_capacity: 4,
    ages: "all",
    status: "published",
    needs: "Whiteboard, printer access",
    phase: "ready",
    verdict: "confirmed",
  },
  {
    id: uuid(103),
    slug: "seed-giant-chess",
    title: "Giant Chess",
    description: "Outdoor chess on the big board.",
    category: "game",
    starts_at: at(7, 14),
    ends_at: at(7, 16),
    location_id: locations.gardens.id,
    max_capacity: 32,
    ages: "all",
    status: "published",
    phase: "ready",
    verdict: "confirmed",
    megagame_integration_level: "low_context_rewards",
  },
  {
    id: uuid(104),
    slug: "seed-treasure-hunt",
    title: "Treasure Hunt",
    description: "A hunt around campus for the under-12s.",
    category: "game",
    starts_at: at(8, 10),
    ends_at: at(8, 12),
    location_id: locations.gardens.id,
    max_capacity: 24,
    ages: "kids",
    status: "published",
    phase: "ready",
    verdict: "confirmed",
  },
  {
    id: uuid(105),
    slug: "seed-unplaced-panel",
    title: "Unplaced Panel",
    description: "An RFP still in grading, with no slot yet.",
    category: "talk",
    status: "draft",
    airtable_rfp_record_id: "recSEED00000001",
    shepherd_user_id: users.admin.id,
    phase: "grading",
    verdict: "needs_follow_up",
    speaker_tier: "free_ticket",
    context: "Submitted via the RFP form.",
    requested_duration: "60 minutes",
    megagame_interest: "willing",
    marketing_consent: true,
    discord_status: "not_yet",
  },
  {
    id: uuid(106),
    slug: "seed-late-night-larp",
    title: "Late Night Larp",
    description: "Adults only; placed but not yet published.",
    category: "game",
    starts_at: at(7, 22),
    ends_at: at(8, 0),
    location_id: locations.courtyard.id,
    max_capacity: 30,
    ages: "adults",
    status: "draft",
    airtable_rfp_record_id: "recSEED00000002",
    shepherd_user_id: users.host.id,
    phase: "scheduling",
    verdict: "probably",
    speaker_tier: "no_comp",
    megagame_interest: "excited",
  },
];

// The published weekend (Fri Nov 6 – Sun Nov 8):
// [id, day, hour, minutes, room, category, title, blurb, ages, cap, extra].
// prettier-ignore
const program = [
  [107, 6, 9, 60, "eigen", "other", "Registration & Breakfast Games", "Badges, pastries, and a 500-piece jigsaw race.", "all", 40],
  [108, 6, 11, 90, "thingspace", "workshop", "Build a Prediction Market in an Hour", "Spreadsheets, bad priors, worse calibration.", "adults", 20],
  [109, 6, 11, 120, "gardens", "game", "Capture the Flag: Bayesian Edition", "Two teams, one flag, priors updated on the fly.", "all", 40, { megagame_integration_level: "low_context_rewards" }],
  [110, 6, 13, 60, "courtyard", "talk", "The History of Cheating at Cards", "From marked decks to shuffle tracking.", "all", 80],
  [111, 6, 14, 120, "glass", "workshop", "Cryptic Crosswords for the Terrified", "Twelve clues, zero judgement.", "all", 12, { min_capacity: 3 }],
  [112, 6, 15, 120, "cantor", "game", "Diplomacy Speed Round", "Seven players, fifteen-minute turns, no friendships.", "adults", 42],
  [113, 6, 16, 60, "attic", "other", "Sunset Tea & Unconference Pitches", "Pitch a Sunday session in sixty seconds.", "all", 25],
  [114, 6, 19, 180, "courtyard", "game", "Megagame Briefing: The Orchard Accords", "Faction leads, read your sealed envelopes.", "all", 80, { megagame_integration_level: "deep" }],
  [115, 6, 21, 120, "thingspace", "game", "Werewolf After Dark", "The classic, with a moderator who holds grudges.", "adults", 20],
  [116, 7, 8, 60, "ratpark", "other", "Morning Run: Fog of War", "A 5k where the route is revealed one checkpoint at a time.", "all", 30],
  [117, 7, 10, 90, "courtyard", "talk", "Why Your Board Game Prototype Is Boring", "A design critique panel, by request only.", "all", 80],
  [118, 7, 10, 120, "cantor", "game", "Escape Room: The Librarian's Lament", "Two rooms, one key, forty minutes per team.", "all", 16, { min_capacity: 4, needs: "Padlocks, a red herring" }],
  [119, 7, 10, 60, "d2", "workshop", "Teaching Kids Go", "Nine-by-nine boards, no stones thrown.", "kids", 12],
  [120, 7, 12, 60, "foodtruck", "other", "Lunch: Blind Taste Test Tournament", "Rank the hot sauces. Then rank your rankings.", "all", 25],
  [121, 7, 13, 120, "thingspace", "talk", "Mechanism Design for Potlucks", "How to get people to bring the dish you want.", "all", 20],
  [122, 7, 13, 180, "courtyard", "game", "Megagame: The Orchard Accords, Turns 1–3", "Trade, scheme, and watch the orchard map change.", "all", 80, { megagame_integration_level: "deep" }],
  [123, 7, 16, 60, "cantor", "talk", "Lightning Talks: Things I Was Wrong About", "Five minutes each, no slides allowed.", "all", 60],
  [124, 7, 17, 60, "eigen", "workshop", "Shuffle Tracking Lab", "Hands-on follow-up to the cheating talk; bring a deck.", "adults", 12],
  [125, 7, 20, 120, "cantor", "game", "Pub Quiz: Metagame Edition", "Rounds on game theory, campus trivia, and each other.", "adults", 60],
  [126, 7, 20, 120, "gardens", "game", "Night Puzzle Hunt", "Headlamps provided; answers are not.", "all", 40, { megagame_integration_level: "puzzle_and_rewards" }],
  [127, 8, 9, 60, "attic", "other", "Puzzle Hunt Debrief", "What the setters meant, what you did instead.", "all", 25],
  [128, 8, 10, 120, "courtyard", "game", "Megagame: The Orchard Accords, Finale", "The envelopes are opened. Someone owns the orchard.", "all", 80, { megagame_integration_level: "deep" }],
  [129, 8, 11, 60, "ground", "workshop", "Origami Dice", "Fold a d6; a d20 for the brave.", "kids", 12],
  [130, 8, 12, 60, "thingspace", "talk", "Calibration Game Results", "Who guessed best all weekend, and by how much.", "all", 20],
  [131, 8, 13, 120, "cantor", "game", "Unconference Block", "Whatever got pitched on Friday.", "all", 60, { verdict: "unconference_schedule" }],
  [132, 8, 14, 60, "gardens", "game", "Kids vs Grownups Relay", "A relay. The kids usually win.", "all", 40],
  [133, 8, 15, 60, "courtyard", "talk", "Closing Ceremony & Awards", "Prizes, confessions, and the last hot sauce.", "all", 80],
  [134, 8, 16, 120, "gardens", "other", "Teardown & Pickup Soccer", "Fold a chair, kick a ball.", "all", 40],
].map(([n, day, hour, minutes, room, category, title, description, ages, cap, extra]) => ({
  id: uuid(n),
  slug: slugify(title),
  title,
  description,
  category,
  starts_at: at(day, hour),
  ends_at: at(day, hour, minutes),
  location_id: locations[room].id,
  max_capacity: cap,
  ages,
  status: "published",
  phase: "ready",
  verdict: "confirmed",
  ...extra,
}));

// Proposals still in the pipeline, weighted towards shepherding like the
// real queue, with the RFP form's free-text fields filled in.
// prettier-ignore
const PHASES = [
  "shepherding", "shepherding", "shepherding", "grading", "shepherding",
  "notifying", "scheduling", "shepherding", "declined", "deciding",
  "shepherding", "shepherding", "notifying", "shepherding", "scheduling",
  "declined", "shepherding", "grading", "shepherding", "notifying",
  "shepherding", "deciding", "scheduling", "shepherding", "declined",
  "shepherding", "grading", "shepherding", "shepherding", "shepherding",
];
// prettier-ignore
const VERDICTS = ["confirmed", "confirmed", "confirmed", "needs_follow_up", "confirmed", "probably", "confirmed", null, "unlikely", "unconference_schedule"];
// prettier-ignore
const TIERS = ["free_ticket", "free_ticket", null, "free_ticket_flights_housing", "free_ticket", null, "no_comp", "free_ticket", null, "free_ticket_flights_housing"];
// prettier-ignore
const INTERESTS = ["not_a_fit", null, "not_a_fit", "excited", "not_a_fit", null, "willing", "not_a_fit", null, "neutral"];
// prettier-ignore
const DISCORD = ["not_yet", "session_host", "not_yet", null, "not_yet", "session_host", "not_yet", null, "session_host", "not_yet"];
// prettier-ignore
const DURATIONS = ["1 hour", "2 hours", "1 hour", "1.5 hours", "1 hour", "3 hours", "1 hour", "90 minutes", "1 Hour", "1 hour seems good"];
const HOUSING = [
  "No housing or travel arrangement on record.",
  "No housing or travel arrangement on record.",
  "Housing: Lighthaven room (onsite), solo; no dates yet.\nTravel: flights covered per the July email; accepted.",
  "No housing or travel arrangement on record.",
  "Housing: Home (self).\nTravel: driving in Thursday night.",
];
const TICKETS = [
  "No ticket, no comp offered. No Ticket Purchases row or Discount Code found.",
  "Has ticket (paid, EARLYBIRD). Reimbursement offered instead of a comp code; not yet sent.",
  "No ticket found; possible comp code. A 100%-off code exists with no email attached, matched by name only.",
  "Comp code issued and redeemed.",
];
// prettier-ignore
const PIPELINE = [
  ["Hexcrawl Design Clinic", "workshop", "Build a six-hex sandbox from a blank map and three rumours."],
  ["Timeshare Pitch (Interactive)", "other", "A fully immersive forty-minute sales pitch. You cannot leave."],
  ["Sealed-Bid Auction Night", "game", "Vickrey, all-pay, and the dreaded dollar auction, for real snacks."],
  ["Mahjong for Beginners", "game", "Riichi rules, four tables, no gambling."],
  ["Negotiation Dojo", "workshop", "Paired drills from the Harvard book, then the fun version."],
  ["The Glass Bead Game, Finally Playable", "game", "Hesse never wrote the rules. We did."],
  ["Speedrunning Bureaucracy", "talk", "Any% in a real DMV, with splits."],
  ["Cardistry Showcase", "other", "Flourishes, fans, and one trick we promise is not a trick."],
  ["Blood on the Clocktower, Two Tables", "game", "Trouble Brewing for new players, Sects & Violets for the brave."],
  ["A Field Guide to Metagaming", "talk", "When optimising the game around the game is the game."],
  ["Puzzle Hunt Postmortem Panel", "talk", "Three setters, one hunt, every mistake."],
  ["Forecasting Tournament Finals", "game", "Top eight calibrators from the summer league, live."],
  ["Paper Prototyping Jam", "workshop", "Index cards, pencils, and a theme revealed at the start."],
  ["Poker Theory Without the Poker", "talk", "Ranges, blockers, and bluffing applied to everything else."],
  ["Six-Hour Twilight Imperium", "game", "One table. Bring a lunch. Bring a grudge."],
  ["Kids' Boffer Arena", "game", "Foam swords, clear rules, a referee with a whistle."],
  ["Escape the Spreadsheet", "game", "A puzzle room built entirely inside one workbook."],
  ["The Economics of Loot Boxes", "talk", "Why the gacha pull hits like it does, with data."],
  ["Tabletop Accessibility Roundtable", "talk", "Colour, text, dexterity, and designing for all of them."],
  ["Go Problems at Dawn", "workshop", "Tsumego for every level, with coffee."],
  ["Hidden Role Games Megatable", "game", "Twenty players, three games stitched into one."],
  ["Sportsball, But Nobody Knows the Rules", "game", "The rules are discovered by playing. Referees are also guessing."],
  ["Cryptic Setter Q&A", "talk", "Ask a setter anything, including that clue."],
  ["Mystery Hunt Reunion Dinner", "other", "Teams past and present, one long table."],
  ["Calibration Trivia: Live Scoring", "game", "Answer, then bet on yourself. Brier scores on the big screen."],
  ["Larp Safety Tools Workshop", "workshop", "Lines, veils, and the open door, practised not lectured."],
  ["Trading Card Economy Simulator", "game", "Open packs, make a market, watch it crash."],
  ["The Great Jigsaw Relay", "game", "Teams of four, one puzzle, hands off until tagged."],
  ["Chess Boxing Exhibition", "other", "Alternating rounds. Medical waiver required."],
  ["Bring-Your-Own-Megagame Clinic", "workshop", "Bring a half-built megagame, leave with a plan."],
];
const pipeline = PIPELINE.map(([title, category, description], k) => {
  const n = 135 + k;
  const phase = PHASES[k];
  const declined = phase === "declined";
  const placed =
    phase === "scheduling" || (phase === "shepherding" && k % 9 === 4);
  const shepherds = [
    users.admin,
    invited[0],
    users.grants,
    invited[1],
    users.host,
    crowd[1],
  ];
  const cohost = k % 2 === 0 ? ghosts[k].name : null;
  return {
    id: uuid(n),
    slug: slugify(title),
    title,
    description,
    category,
    status: "draft",
    ages: k % 11 === 7 ? "kids" : k % 7 === 2 ? "adults" : "all",
    starts_at: placed ? at(7 + (k % 2), 10 + (k % 5) * 2) : null,
    ends_at: placed
      ? at(7 + (k % 2), 10 + (k % 5) * 2, 60 + (k % 3) * 30)
      : null,
    location_id: placed && k % 3 ? Object.values(locations)[k % 13].id : null,
    max_capacity: k % 4 ? 12 + (k % 5) * 8 : null,
    airtable_rfp_record_id: `recSEED${String(n).padStart(8, "0")}`,
    shepherd_user_id: declined ? null : shepherds[k % shepherds.length].id,
    phase,
    verdict: declined ? (k % 2 ? "rejected" : "unlikely") : VERDICTS[k % 10],
    speaker_tier: TIERS[k % 10],
    context: `${description} We ran a version at a house party in March for about ${8 + k} people and it held together; the second half drags if nobody takes the villain role, so we'd seed one. Happy to run it twice if the slot is short. The materials fit in one tote bag.`,
    requested_duration: DURATIONS[k % 10],
    cohosts: cohost,
    timing_constraints:
      k % 5 < 3
        ? [
            "Not Friday morning, flying in.",
            "Any time after lunch.",
            "Saturday only; leaving Sunday 8am.",
          ][k % 3]
        : null,
    other_constraints: k % 10 < 3 ? "Needs a room that can get loud." : null,
    age_elaboration:
      k % 11 === 7
        ? "Roughly 7 to 12; parents welcome to stay."
        : k % 7 === 2
          ? "Themes of betrayal and mild violence."
          : null,
    application_required:
      k % 10 === 9
        ? "Short form: have you played before, and are you okay losing?"
        : null,
    bespoke_needs:
      k % 3 === 0
        ? [
            "Projector and HDMI.",
            "Two long tables pushed together.",
            "Outdoor space with a wall to tape things to.",
          ][k % 3]
        : null,
    anything_else:
      k % 3 === 1 ? "First time proposing; happy to be shepherded." : null,
    megagame_interest: INTERESTS[k % 10],
    marketing_consent: k % 3 === 0,
    discord_status: DISCORD[k % 10],
    megagame_notes:
      k % 15 === 3 ? "Could feed into the orchard map as a side quest." : null,
    ticket_state: k % 10 === 8 ? null : TICKETS[k % 4],
    housing_status: k % 10 === 8 ? null : HOUSING[k % 5],
    communication_notes:
      k % 10 === 8
        ? null
        : `Shepherd emailed ${["2026-09-14", "2026-09-30", "2026-10-07", "2026-10-15"][k % 4]}; ${["replied same day, keen.", "no reply yet, nudged once.", "replied, asked about housing.", "confirmed the slot works."][k % 4]}`,
    ricki_notes: k % 4 === 1 ? "Strong yes if the slot can be found." : null,
    megagame_integration_level: k % 15 === 3 ? "low_context_rewards" : null,
  };
});

const sessions = [...handmade, ...program, ...pipeline];

// Crowd members host the generated sessions. Every third session also has a
// co-host who was added by the schedule tool and never signed in.
const crowdHosts = [...program, ...pipeline].flatMap((s, k) => {
  const lead = crowd[(k * 13) % 100];
  const co = invited.find((u, j) => u !== lead && j >= k % invited.length);
  return [
    { session_id: s.id, position: 0, user_id: lead.id },
    ...(k % 3 === 0 ? [{ session_id: s.id, position: 1, user_id: co.id }] : []),
  ];
});

// Each speaker co-hosts one to three program sessions, billed after whoever
// the crowd already put on them.
const lastPosition = new Map(crowdHosts.map((h) => [h.session_id, h.position]));
const speakerHosts = speakers.flatMap((u, i) =>
  [i, i + 7, i + 14].slice(0, 1 + (i % 3)).map((k) => {
    const s = program[k % program.length];
    const position = (lastPosition.get(s.id) ?? -1) + 1;
    lastPosition.set(s.id, position);
    return { session_id: s.id, position, user_id: u.id };
  }),
);

// Prod's tier names and price points, in roughly prod's proportions: mostly
// early-bird code, a third comped, a few full price, day passes, a supporter.
const T_FULL = "Metagame 2026";
const T_DAY = "Metagame 2026 Day Pass - Saturday";
const T_PACK = "Family & Friends Pack — Standard";
const T_SUP = "Metagame 2026 -- Supporter";
// prettier-ignore
const PRICES = [1, 1, 1, 1, 2, 2, 2, 0, 3, 1].map((p) => [
  { tier: T_FULL, amount_cents: 42500 },
  { tier: T_FULL, amount_cents: 32500, coupon_code: "SEEDBIRD" },
  { tier: T_FULL, amount_cents: 0, coupon_code: "COMP" },
  { tier: T_DAY, amount_cents: 22500 },
][p]);
const price = (i) => {
  const p = i === 21 ? { tier: T_SUP, amount_cents: 65000 } : PRICES[i % 10];
  return p.coupon_code === "COMP"
    ? { ...p, coupon_code: `COMP-${LAST[(i * 7) % 100].toUpperCase()}` }
    : p;
};

const ticket = (payment_id, rest) => ({
  payment_id,
  ticket_code: ticketCode(payment_id),
  source: "stripe",
  status: "paid",
  test: false,
  tier: T_FULL,
  amount_cents: 42500,
  coupon_code: null,
  purchaser_email: null,
  purchaser_name: null,
  purchaser_discord: null,
  owner_user_id: null,
  claimed_at: null,
  holder_user_id: null,
  ...rest,
});

const tickets = [
  ticket("pi_seed_paid_claimed", {
    purchaser_email: "attendee@metagame.games",
    purchaser_name: "Seed Attendee",
    purchaser_discord: "seed_attendee",
    owner_user_id: users.attendee.id,
    claimed_at: "2026-10-01T12:00:00Z",
  }),
  ticket("pi_seed_paid_unclaimed", {
    purchaser_email: "newcomer@metagame.games",
    purchaser_name: "Seed Newcomer",
  }),
  ticket("pi_seed_pending", {
    status: "pending",
    tier: T_DAY,
    amount_cents: 22500,
    purchaser_email: "pending@metagame.games",
  }),
  ticket("pi_seed_failed", {
    status: "failed",
    purchaser_email: "failed@metagame.games",
  }),
  ticket("on_seed_underpaid", {
    source: "opennode",
    status: "underpaid",
    amount_cents: 41000,
    purchaser_email: "underpaid@metagame.games",
  }),
  ticket("on_seed_paid", {
    source: "opennode",
    purchaser_email: "bitcoiner@metagame.games",
  }),
  ...[1, 2, 3].map((n) =>
    ticket(`pi_seed_pack:ticket:${n}`, {
      tier: T_PACK,
      amount_cents: 37500,
      purchaser_email: "host@metagame.games",
      purchaser_name: "Seed Host",
      owner_user_id: n === 1 ? users.host.id : null,
      claimed_at: n === 1 ? "2026-10-02T12:00:00Z" : null,
      holder_user_id: n === 2 ? users.grants.id : null,
    }),
  ),
  ticket("admin:seed-comp", {
    source: "admin",
    amount_cents: 0,
    coupon_code: "SEEDCOMP",
    purchaser_email: "grants@metagame.games",
    owner_user_id: users.grants.id,
    claimed_at: "2026-10-03T12:00:00Z",
  }),
  ticket("pi_seed_test", {
    test: true,
    purchaser_email: "tester@metagame.games",
  }),
  // Team and schedule team hold comped tickets, so they are also Attendees.
  ...[users.team, users.schedule].map((u, n) =>
    ticket(`admin:${u.id}-comp`, {
      source: "admin",
      amount_cents: 0,
      coupon_code: "SEEDCOMP",
      purchaser_email: `${u.id.replace("seed-", "")}@metagame.games`,
      purchaser_name: u.name,
      owner_user_id: u.id,
      claimed_at: `2026-10-0${4 + n}T12:00:00Z`,
    }),
  ),
  ...crowd
    .filter((u) => u.kind === "attendee" || u.kind === "buyer")
    .map((u) =>
      ticket(`pi_seed_${u.id}`, {
        ...price(u.i),
        purchaser_email: u.email,
        purchaser_name: u.name,
        purchaser_discord: u.i % 3 === 2 ? null : u.email.split("@")[0],
        owner_user_id: u.kind === "attendee" ? u.id : null,
        claimed_at:
          u.kind === "attendee"
            ? new Date(Date.UTC(2026, 8, 1, 12, u.i * 11)).toISOString()
            : null,
      }),
    ),
  ...ghosts.map((g) =>
    ticket(`pi_seed_ghost_${String(g.i + 1).padStart(2, "0")}`, {
      ...price(g.i + 2),
      test: g.i % 20 === 0,
      purchaser_email: g.email,
      purchaser_name: g.name,
      purchaser_discord: g.i % 3 === 0 ? null : g.email.split("@")[0],
    }),
  ),
];

// Crowd RSVPs: `going` until the session is full, then `waitlist`.
const crowdRsvps = [];
const fill = (n, pick, cap) => {
  let going = sessions.find((s) => s.id === uuid(n)).max_capacity - cap;
  for (const u of crowd.filter((u) => u.verified && pick(u))) {
    crowdRsvps.push({
      session_id: uuid(n),
      user_id: u.id,
      status: going-- > 0 ? "going" : "waitlist",
    });
  }
};
fill(101, (u) => u.i % 5 !== 0, 2);
fill(102, (u) => u.i % 7 === 0, 1);
fill(103, (u) => u.i % 3 === 0, 1);
fill(104, (u) => u.i % 10 === 0, 0);
// Interest varies by session: between a tenth and half of the crowd.
program.forEach((s, k) =>
  fill(Number(s.id.slice(-3)), (u) => (u.i * 7 + k) % 11 < 1 + (k % 5), 0),
);

// One grade per proposal from a team member, most of them submitted, with
// the rooms the grader thought would fit.
// prettier-ignore
const RUBRIC = ["good", "best", "good", "meh", "good", "unclear", "best", "good", "bad", "good"];
// prettier-ignore
const TOPICS = ["{board_games}", "{puzzle_hunts,word_puzzles}", "{larps,immersive_experience}", "{card_games}", "{ttrpgs}", "{party_game,physical_games}", "{escape_rooms}", "{video_games}", "{number_puzzles}"];
const graders = [
  users.admin,
  users.host,
  users.grants,
  crowd[1],
  crowd[2],
  crowd[3],
  crowd[5],
  crowd[6],
  crowd[7],
];
const grades = [
  {
    id: uuid(201),
    session_id: uuid(105),
    grader_user_id: users.admin.id,
    operational_ease: "good",
    host_competence: "good",
    host_name_recognition: "meh",
    subject_matter: "good",
    fun: "best",
    verdict_recommendation: "probably",
    quality_notes: "Strong pitch, needs a slot.",
    scheduler_notes: "Any afternoon; wants the lounge.",
    shepherd_match: "positive",
    topic_areas: "{puzzle_hunts,word_puzzles}",
    potential_panels: "{}",
    megagame_integration: "Could hand out orchard tokens as prizes.",
    expected_crowd_size: 30,
    allow_dropins: "welcome",
    submitted_at: "2026-10-05T12:00:00Z",
  },
  ...pipeline
    .filter((s, k) => k % 8 !== 5)
    .map((s, k) => ({
      id: uuid(202 + k),
      session_id: s.id,
      grader_user_id: graders[k % graders.length].id,
      operational_ease: RUBRIC[k % 10],
      host_competence: RUBRIC[(k + 3) % 10],
      host_name_recognition: k % 6 === 0 ? null : RUBRIC[(k + 5) % 10],
      subject_matter: RUBRIC[(k + 7) % 10],
      fun: RUBRIC[(k + 1) % 10],
      verdict_recommendation: k % 3 === 0 ? null : VERDICTS[k % 10],
      quality_notes: [
        "Clear, well scoped.",
        "Fun but the host is untested.",
        "Would be better as an unconference slot.",
        null,
      ][k % 4],
      scheduler_notes:
        k % 3 === 2
          ? null
          : [
              "Evening slot, needs darkness.",
              "Morning, before the megagame.",
              "Anywhere with tables.",
            ][k % 3],
      shepherd_match: [
        "negative",
        "neutral",
        "positive",
        "neutral",
        "negative",
        "positive",
        "other",
      ][k % 7],
      topic_areas: TOPICS[k % TOPICS.length],
      potential_panels: "{}",
      megagame_integration:
        k % 4 === 3
          ? null
          : ["None, standalone.", "Side quest material.", "Prize tokens only."][
              k % 3
            ],
      expected_crowd_size: 10 + (k % 6) * 10,
      allow_dropins: ["welcome", "full_block", "spectate", "welcome", "other"][
        k % 5
      ],
      submitted_at:
        k === 4
          ? null
          : `2026-10-${String(2 + (k % 14)).padStart(2, "0")}T18:00:00Z`,
    })),
];
const rooms = Object.values(locations);
const spaceOptions = grades.flatMap((g, k) =>
  rooms
    .slice(k % 5, (k % 5) + 1 + (k % 7))
    .map((l) => ({ grade_id: g.id, location_id: l.id })),
);

// The apiKey plugin stores base64url(sha256(key)); this key is public and
// only works on a seeded branch.
const API_KEY =
  "mg_seed_metabot_000000000000000000000000000000000000000000000000000";
const apiKeys = [
  {
    id: "seed-apikey-metabot",
    name: "metabot",
    start: API_KEY.slice(0, 6),
    prefix: "mg_",
    key: createHash("sha256").update(API_KEY).digest("base64url"),
    reference_id: users.admin.id,
    enabled: true,
    rate_limit_enabled: false,
    rate_limit_time_window: 86400000,
    rate_limit_max: 10,
    request_count: 0,
  },
];

const counts = {};

counts.ledger = await seedMigrationLedger();

// Seed rows the script no longer produces, so a changed script converges.
// Child rows of seed users and seed sessions are simply rebuilt.
const SEED_UUID = "00000000-0000-4000-8000-%";
for (const [table, col] of [
  ["rsvps", "user_id"],
  ["bookmarks", "user_id"],
  ["user_roles", "user_id"],
  ["user_permission_grants", "user_id"],
]) {
  await sql.query(`delete from "${table}" where "${col}" like 'seed-%'`);
}
for (const table of ["session_hosts"]) {
  await sql.query(`delete from ${table} where session_id::text like $1`, [
    SEED_UUID,
  ]);
}
await sql.query(`delete from session_grades where id::text like $1`, [
  SEED_UUID,
]);
await sql.query(
  `delete from sessions where id::text like $1 and not (id::text = any($2::text[]))`,
  [SEED_UUID, pgArray(sessions.map((s) => s.id))],
);
await sql.query(
  `delete from account where provider_id = 'credential'
   and user_id like 'seed-%' and not (user_id = any($1::text[]))`,
  [pgArray(everyone.filter((u) => u.verified).map((u) => u.id))],
);
await sql.query(
  `delete from tickets where payment_id like '%seed%'
   and not (payment_id = any($1::text[]))`,
  [pgArray(tickets.map((t) => t.payment_id))],
);
await sql.query(
  `delete from "user" where id like 'seed-%' and not (id = any($1::text[]))`,
  [pgArray(everyone.map((u) => u.id))],
);
// Speaker accounts carry their real ids, so they're found by email instead.
await sql.query(
  `delete from "user" where email like $1 and not (id = any($2::text[]))`,
  [SPEAKER_EMAIL, pgArray(speakers.map((u) => u.id))],
);

const userRow = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  email_verified: u.verified,
  role: u.role ?? "user",
  banned: u.banned ?? false,
  ban_reason: u.ban_reason ?? null,
  wizard_level: u.levels?.wizard ?? 0,
  pirate_level: u.levels?.pirate ?? 0,
  alien_level: u.levels?.alien ?? 0,
});
const credential = (u) => ({
  id: `${u.id}-credential`,
  account_id: u.id,
  provider_id: "credential",
  user_id: u.id,
  password: passwordHash,
});
counts.user = await upsert("user", ["id"], everyone.map(userRow));
counts.account = await upsert(
  "account",
  ["id"],
  everyone.filter((u) => u.verified).map(credential),
);
counts.profiles = await upsert("profiles", ["user_id"], everyone.map(profile));

// Attendee is the built-in role src/lib/permission-store.ts expects by name;
// Team holds everything short of admin.
const roleRows = await Promise.all(
  [
    { name: "Attendee", permissions: ["schedule.rsvps"] },
    {
      name: "Team",
      permissions: [
        "links.manage",
        "promo.create",
        "promo.manage",
        "promo.view",
        "schedule.manage",
        "schedule.preview",
        "schedule.rsvps",
        "schema.view",
        "submissions.grade",
        "tickets.view",
        "users.view",
      ],
    },
    { name: "Schedule team", permissions: ["schedule.manage", "users.view"] },
  ].map(async (r) => {
    const [{ id }] = await sql.query(
      `insert into roles (name) values ($1)
       on conflict (name) do update set updated_at = now() returning id`,
      [r.name],
    );
    return { ...r, id };
  }),
);
counts.roles = roleRows.length;
counts.role_permissions = await upsert(
  "role_permissions",
  ["role_id", "permission"],
  roleRows.flatMap((r) =>
    r.permissions.map((permission) => ({ role_id: r.id, permission })),
  ),
);
const roleId = (name) => roleRows.find((r) => r.name === name).id;
const team = [
  users.host,
  users.team,
  users.grants,
  ...graders.slice(3),
  invited[0],
  invited[1],
  invited[2],
];
counts.user_roles = await upsert(
  "user_roles",
  ["user_id", "role_id"],
  [
    ...team.map((u) => ({ user_id: u.id, role_id: roleId("Team") })),
    { user_id: users.host.id, role_id: roleId("Schedule team") },
    { user_id: users.schedule.id, role_id: roleId("Schedule team") },
  ],
);
counts.user_permission_grants = await upsert(
  "user_permission_grants",
  ["user_id", "permission"],
  ["tickets.view", "links.manage"].map((permission) => ({
    user_id: users.grants.id,
    permission,
  })),
);

counts.tickets = await upsert("tickets", ["payment_id"], tickets);

counts.locations = await upsert(
  "locations",
  ["id"],
  rooms.filter((l) => !reusedRooms.has(l)),
);
counts.sessions = await upsert("sessions", ["id"], sessions);
counts.session_hosts = await upsert(
  "session_hosts",
  ["session_id", "position"],
  [
    { session_id: uuid(101), position: 0, user_id: users.host.id },
    { session_id: uuid(102), position: 0, user_id: users.host.id },
    { session_id: uuid(103), position: 0, user_id: users.host.id },
    { session_id: uuid(103), position: 1, user_id: users.grants.id },
    { session_id: uuid(104), position: 0, user_id: users.attendee.id },
    { session_id: uuid(105), position: 0, user_id: users.newcomer.id },
    { session_id: uuid(106), position: 0, user_id: users.grants.id },
    ...crowdHosts,
    ...speakerHosts,
  ],
);
counts.rsvps = await upsertRsvps([
  { session_id: uuid(101), user_id: users.attendee.id, status: "going" },
  { session_id: uuid(101), user_id: users.newcomer.id, status: "going" },
  { session_id: uuid(102), user_id: users.attendee.id, status: "waitlist" },
  { session_id: uuid(102), user_id: users.grants.id, status: "going" },
  { session_id: uuid(103), user_id: users.attendee.id, status: "going" },
  ...crowdRsvps,
]);
counts.bookmarks = await upsert(
  "bookmarks",
  ["session_id", "user_id"],
  [
    { session_id: uuid(104), user_id: users.attendee.id },
    { session_id: uuid(103), user_id: users.newcomer.id },
    ...crowd
      .filter((u) => u.verified && u.i % 6 === 1)
      .map((u) => ({ session_id: uuid(103), user_id: u.id })),
    ...crowd
      .filter((u) => u.verified && u.i % 9 === 2)
      .map((u) => ({ session_id: uuid(102), user_id: u.id })),
    ...program.flatMap((s, k) =>
      crowd
        .filter((u) => u.verified && (u.i * 5 + k) % 13 === 0)
        .map((u) => ({ session_id: s.id, user_id: u.id })),
    ),
  ],
);

counts.session_grades = await upsert("session_grades", ["id"], grades);
counts.session_grade_space_options = await upsert(
  "session_grade_space_options",
  ["grade_id", "location_id"],
  spaceOptions,
);
counts.apikey = await upsert("apikey", ["id"], apiKeys);

for (const [table, n] of Object.entries(counts)) {
  console.log(`[db:seed] ${table}: ${n}`);
}
console.log(`[db:seed] done on ${host}`);
