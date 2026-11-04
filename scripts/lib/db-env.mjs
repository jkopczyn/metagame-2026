// Compute endpoint of the Neon `main` branch (prod).
const PROD_ENDPOINT = "ep-crimson-sky-b8tcqhxv";

/**
 * Loads the env files DB scripts read. `vercel pull` writes the environment's
 * vars under .vercel/; locally they come from .env.local. Vars already in the
 * environment are never overridden. Only db:migrate, which the production
 * deploy runs, may pick up the production file: a wipe or a seed must be aimed
 * at a database on purpose.
 */
export function loadDbEnv({ production = false } = {}) {
  const files = [
    ".env.local",
    ...(production ? [".vercel/.env.production.local"] : []),
    ".vercel/.env.preview.local",
  ];
  for (const file of files) {
    try {
      process.loadEnvFile(file);
    } catch {
      // file absent
    }
  }
}

export function isProductionDatabase(url, env = process.env) {
  return (
    env.VERCEL_ENV === "production" ||
    new URL(url).hostname.startsWith(PROD_ENDPOINT)
  );
}

/** Exits 1 if `url` is production; otherwise returns its host for logging. */
export function refuseProductionDatabase(scriptName, url) {
  const host = new URL(url).hostname;
  if (isProductionDatabase(url)) {
    console.error(
      `[${scriptName}] refusing to touch the production database (${host})`,
    );
    process.exit(1);
  }
  return host;
}
