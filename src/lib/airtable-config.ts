import { fetchWithin } from "@/lib/fetch-timeout";

// Public Airtable identifiers for the Metagame 2026 base. These aren't secrets —
// they're useless without AIRTABLE_API_KEY (the one real credential, still in env) —
// so they live in committed config instead of masquerading as env vars. Repoint here
// if the destination base/table ever changes.
export const airtableConfig = {
  /** Metagame 2026 base. */
  baseId: "appROpPV6XUP4CSqX",
  /** "Interest Intake" table — email signups. */
  signupsTableId: "tbluUIxg0YnlMO1jQ",
  /** Email column in the signups table (also the upsert key). */
  signupEmailField: "Email",
  /** "Stripe Purchases" table — ticket purchases recorded by the webhook. */
  purchasesTableId: "tblMEDrxbS2abAHob",
  /** "Discount Codes" table — server-validated BTC discount codes (ground truth). */
  discountCodesTableId: "tble7XP43WyeKeHXd",
  /** "META Cryptic Clues" table — clues submitted from the FAQ whiteboard lightbox. */
  crypticCluesTableId: "tblzZTAMKKftdRROy",
  /** "RFP Submissions" table — session proposals + the speaker committee's rubric. */
  rfpSubmissionsTableId: "tbl31UWBj60gQemuw",
  /** "Egg Tracking" table — easter eggs found on the dividers. */
  eggTrackingTableId: "tblpz5jxmWsC6R4av",
  /** "Tracking Links" table — short links served at /go/{slug}. */
  trackingLinksTableId: "tblcujqHGF3UeD4wU",
  /** "Discord Outreach CRM" table — server names double as tracking-link placements. */
  discordOutreachTableId: "tbl5BLBZKuUTuB0Bw",
  /** Megagame puzzle & game submissions (the /megagame/build journey). */
  megagameSubmissionsTableId: "tblYNXIIhWqMpQwVO",
  /** Volunteer applications; financial aid applications land here too. */
  volunteersTableId: "tblwgd6l8wPe42gf7",
  /** Children registered for the weekend (the /childcare/register journey). */
  childrenTableId: "tblsysyESXwF1ai6R",
  /** Night Market booth applications (the /night-market/apply journey). */
  nightMarketBoothsTableId: "tblr5fkV7iqgtGBtk",
} as const;

/** Every Airtable API call goes through this, so a stall can't hold a request open. */
export const airtableFetch = fetchWithin(10_000);
