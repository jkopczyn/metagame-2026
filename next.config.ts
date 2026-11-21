import type { NextConfig } from "next";
import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
} from "next/constants";
import { buildErd } from "./scripts/build-erd.mjs";
import { validateEnv } from "./src/env";
import { EGG_TIER_2027, boothLinks, stripeMode } from "./src/lib/tickets";
import {
  CHILD_REGISTRATION_FORM_URL,
  CON_PARTIFUL_PATH,
  CON_PARTIFUL_URL,
  FINANCIAL_AID_FORM_URL,
  HOUSING_PATH,
  HOUSING_URL,
  INTEREST_FORM_URL,
  MEGAGAME_PROPOSAL_FORM_URL,
  NIGHT_MARKET_FORM_URL,
  NIGHT_PARTIFUL_PATH,
  NIGHT_PARTIFUL_URL,
  RFP_FORM_URL,
  SPONSOR_FORM_URL,
  VOLUNTEER_APPLY_PATH,
  VOLUNTEER_FORM_PATH,
} from "./src/v2/lib/links";

// Missing required env vars warn locally and fail the build on Vercel.
validateEnv();

const nextConfig: NextConfig = {
  // Vercel skew protection keeps an old deployment serving its own assets and
  // server functions to tabs that loaded it, instead of 404ing them once a
  // newer deploy takes the domain. It only works if the build knows its own
  // id, and our builds run in GitHub Actions (`vercel build` + `--prebuilt`),
  // where Vercel's id isn't known yet — so the workflows mint one. Unset
  // locally, which just means no `?dpl=` on asset URLs.
  deploymentId: process.env.DEPLOYMENT_ID,
  // Headless Chromium for the quest-card PDF; Next must not bundle these.
  serverExternalPackages: ["@sparticuz/chromium", "playwright-core"],
  outputFileTracingIncludes: {
    // playwright-core reads browsers.json by a path the tracer can't follow.
    "/backstage/quests/print/pdf": [
      "./node_modules/playwright-core/**",
      "./node_modules/@sparticuz/chromium/bin/**",
    ],
    "/backstage/quests/print/pdf-lib": [
      "./assets/posters/fonts/*.ttf",
      "./public/megagame/quest-art/*",
    ],
    "/api/posters": [
      "./assets/posters/*.pdf",
      "./assets/posters/sponsors/*.png",
      "./assets/posters/overlays/*.png",
      "./assets/posters/fonts/*.ttf",
    ],
    // The email catalog reads emails/ (sent) and emails/drafts/ at request
    // time. Keys are globs, so `[slug]` can't be spelled out.
    "/backstage/signs/app": ["./assets/signs/metagame-signs.html"],
    "/backstage/emails": ["./emails/*", "./emails/drafts/*"],
    "/backstage/emails/**": ["./emails/*", "./emails/drafts/*"],
    // Ticket webhooks send the one-week-out email from the same files.
    "/api/stripe-webhook": ["./emails/*", "./emails/drafts/*"],
    "/api/opennode-webhook": ["./emails/*", "./emails/drafts/*"],
  },
  // public/ files are served max-age=0 by default, so the hero backdrop
  // revalidated on every visit. Filenames are stable; bump them if the
  // images change.
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ],
    },
    {
      source: "/images/puzzle/:path*",
      headers: [
        { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
      ],
    },
  ],
  rewrites: async () => [
    // The Chain Mail puzzle terminal is a standalone page in public/.
    { source: "/chainmail", destination: "/chainmail.html" },
  ],
  redirects: async () => [
    // The team tools were /admin until the permission system made them
    // everyone's; bookmarks and old links keep working.
    { source: "/admin", destination: "/backstage", permanent: true },
    {
      source: "/admin/:path*",
      destination: "/backstage/:path*",
      permanent: true,
    },
    // The speaker committee board moved under /backstage with the other tools.
    {
      source: "/speaker_committee",
      destination: "/backstage/speaker-committee",
      permanent: true,
    },
    // The committee board replaced /grade's own overview; the rubric for one
    // proposal stays at /grade/<id>.
    {
      source: "/grade",
      destination: "/backstage/speaker-committee",
      permanent: true,
    },
    // Key dates used to be its own page, then a home-page section; now gone.
    { source: "/key-dates", destination: "/", permanent: true },
    // The sponsor page is gone until there's 2027 info; the form is the way in.
    { source: "/sponsor", destination: SPONSOR_FORM_URL, permanent: false },
    { source: "/team/join", destination: INTEREST_FORM_URL, permanent: true },
    // The 2026 forms are closed until 2027 plans firm up; the interest form
    // takes those for now. Drop a path here to reopen its form.
    ...[
      RFP_FORM_URL,
      MEGAGAME_PROPOSAL_FORM_URL,
      VOLUNTEER_APPLY_PATH,
      VOLUNTEER_FORM_PATH,
      CHILD_REGISTRATION_FORM_URL,
      FINANCIAL_AID_FORM_URL,
      NIGHT_MARKET_FORM_URL,
    ].map((source) => ({
      source,
      destination: INTEREST_FORM_URL,
      permanent: false,
    })),
    // /buy/<code> hands its code to the tickets section, which stores it for Standard checkout.
    { source: "/buy", destination: "/#tickets", permanent: false },
    {
      source: "/buy/:promo",
      destination: "/?promo=:promo#tickets",
      permanent: false,
    },
    // Short links into Standard checkout; /ticket/<code> pre-applies a promo code.
    {
      source: "/:path(ticket|tickets)",
      destination: "/api/checkout/stripe?tier=standard",
      permanent: false,
    },
    {
      source: "/:path(ticket|tickets)/:promo",
      destination: "/api/checkout/stripe?tier=standard&promo=:promo",
      permanent: false,
    },
    // A friend's referral link: the tickets section with their code filled in.
    {
      source: "/invite/:ref",
      destination: "/?ref=:ref#tickets",
      permanent: false,
    },
    // Hat Tricks' address before the booklet's /hat-tricks became the page.
    {
      source: "/megagame/hat-tricks",
      destination: "/hat-tricks",
      permanent: false,
    },
    // Shareable short links to the Partiful RSVPs.
    {
      source: CON_PARTIFUL_PATH,
      destination: CON_PARTIFUL_URL,
      permanent: false,
    },
    {
      source: NIGHT_PARTIFUL_PATH,
      destination: NIGHT_PARTIFUL_URL,
      permanent: false,
    },
    // Short link to on-site housing at Lighthaven.
    {
      source: HOUSING_PATH,
      destination: HOUSING_URL,
      permanent: false,
    },
    // Short link to the booth-only Night Market purchase.
    {
      source: "/booth",
      destination: boothLinks[stripeMode],
      permanent: false,
    },
    // Post-con feedback forms (Airtable).
    {
      source: "/feedback",
      destination:
        "https://airtable.com/appROpPV6XUP4CSqX/pagf4zOsMYDcm8HX5/form",
      permanent: false,
    },
    {
      source: "/session-feedback",
      destination:
        "https://airtable.com/appROpPV6XUP4CSqX/pag8WRNjjwVgXHWMv/form",
      permanent: false,
    },
    // Metagame 2027 ultra early bird tickets (Stripe payment link).
    {
      source: "/2027",
      destination: EGG_TIER_2027.links[stripeMode],
      permanent: false,
    },
  ],
  // Let LAN devices (phones) load /_next dev assets; without this the Network URL serves HTML but never hydrates.
  allowedDevOrigins: ["10.*.*.*", "192.168.*.*", "157.230.177.203"],
};

export default function config(phase: string): NextConfig {
  // The ER diagram under /backstage/schema is generated from drizzle/*.sql.
  // Done here rather than in a package.json script so it runs however the
  // site is built (pnpm build, next build, Vercel).
  if (phase === PHASE_PRODUCTION_BUILD || phase === PHASE_DEVELOPMENT_SERVER) {
    buildErd();
  }
  return nextConfig;
}
