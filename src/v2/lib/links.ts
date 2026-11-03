// External links, in one place so copy never hardcodes a URL that later rots.

// The site's forms, each a journey page of its own (src/v2/forms): propose a
// session (/propose is also the printed short link), build part of the
// Megagame, volunteer, register children, join the team, sponsor, apply for
// financial aid, and run a Night Market booth.
export const RFP_FORM_URL = "/propose";
export const MEGAGAME_PROPOSAL_FORM_URL = "/megagame/build";
export const VOLUNTEER_APPLY_PATH = "/volunteer/apply";
// Short link to the volunteer journey for tracking links: it passes utm_*
// through to the page, which stores them for the application.
export const VOLUNTEER_FORM_PATH = "/volunteer-form";
// Required for every attending child (childcare or not).
export const CHILD_REGISTRATION_FORM_URL = "/childcare/register";
export const JOIN_TEAM_FORM_URL = "/team/join";
export const SPONSOR_FORM_URL = "/sponsor/interest";
export const FINANCIAL_AID_FORM_URL = "/financial-aid";

// What volunteering on each team involves (linked from the volunteer journey).
export const VOLUNTEER_TEAMS_DOC_URL =
  "https://docs.google.com/document/d/1AOKulmKhgzZ0ms2wFEzqga7SA76dKB3lsoj2u0bOxWs/edit?usp=sharing";

// On-site housing at Lighthaven.
export const HOUSING_URL =
  "https://www.havenbookings.space/events/metagame-2026";

// Manifund fiscal-sponsorship page for tax-deductible donations.
export const MANIFUND_URL = "https://manifund.org/projects/metagame-2026";

export const LIGHTHAVEN_URL = "https://lighthaven.space/";

// Google search for hotels near the venue, linked from the FAQ.
export const HOTELS_SEARCH_URL =
  "https://www.google.com/search?q=hotels+near+lighthaven+in+berkeley&ie=UTF-8";
export const LAST_YEAR_SITE_URL = "https://2025.metagame.games";
// Ricki on the Complex Systems podcast, talking about Metagame 2025.
export const PODCAST_EPISODE_URL =
  "https://www.complexsystemspodcast.com/episodes/narrative-mastery-character-bleed-in-games-with-ricki-heicklen/";
export const TEAM_EMAIL = "team@metagame.games";

// Partiful RSVPs. /partiful and /partiful-night-market redirect to these.
export const CON_PARTIFUL_URL =
  "https://partiful.com/e/EpgMaEedtQaPovkplnUv?c=Yw4shqHd";
export const CON_PARTIFUL_PATH = "/partiful";
// The Friday-night public event's free Partiful RSVP.
export const NIGHT_PARTIFUL_URL = "https://partiful.com/e/TirHoKkdE8DUiWHCt59v";
export const NIGHT_PARTIFUL_PATH = "/partiful-night-market";

// Night Market booth application.
export const NIGHT_MARKET_FORM_URL = "/night-market/apply";
