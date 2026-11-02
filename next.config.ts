import type { NextConfig } from "next";
import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
} from "next/constants";
import { buildErd } from "./scripts/build-erd.mjs";
import { validateEnv } from "./src/env";
import {
  CON_PARTIFUL_PATH,
  CON_PARTIFUL_URL,
  NIGHT_PARTIFUL_PATH,
  NIGHT_PARTIFUL_URL,
} from "./src/v2/lib/links";

// Warn (don't fail) on missing required env vars at build / dev start.
validateEnv();

const nextConfig: NextConfig = {
  // Vercel skew protection keeps an old deployment serving its own assets and
  // server functions to tabs that loaded it, instead of 404ing them once a
  // newer deploy takes the domain. It only works if the build knows its own
  // id, and our builds run in GitHub Actions (`vercel build` + `--prebuilt`),
  // where Vercel's id isn't known yet — so the workflows mint one. Unset
  // locally, which just means no `?dpl=` on asset URLs.
  deploymentId: process.env.DEPLOYMENT_ID,
  outputFileTracingIncludes: {
    "/api/posters": [
      "./assets/posters/*.pdf",
      "./assets/posters/sponsors/*.png",
      "./assets/posters/overlays/*.png",
      "./assets/posters/fonts/*.ttf",
    ],
    // The sent-email catalog reads emails/ at request time. Keys are globs,
    // so `[slug]` can't be spelled out.
    "/backstage/emails": ["./emails/*"],
    "/backstage/emails/**": ["./emails/*"],
  },
  // public/ files are served max-age=0 by default, so the hero backdrop
  // revalidated on every visit. Filenames are stable; bump them if the
  // images change.
  headers: async () => [
    {
      source: "/images/puzzle/:path*",
      headers: [
        { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
      ],
    },
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
    // /buy/<code> hands its code to the home page, which stores it for Standard checkout.
    { source: "/buy", destination: "/", permanent: false },
    { source: "/buy/:promo", destination: "/?promo=:promo", permanent: false },
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
  ],
  // Let LAN devices (phones) load /_next dev assets; without this the Network URL serves HTML but never hydrates.
  allowedDevOrigins: ["10.*.*.*", "192.168.*.*", "157.230.177.203"],
};

export default function config(phase: string): NextConfig {
  // The ER diagram under /backstage/schema/erd is generated from drizzle/*.sql.
  // Done here rather than in a package.json script so it runs however the
  // site is built (pnpm build, next build, Vercel).
  if (phase === PHASE_PRODUCTION_BUILD || phase === PHASE_DEVELOPMENT_SERVER) {
    buildErd();
  }
  return nextConfig;
}
