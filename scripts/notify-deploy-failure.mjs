// Run by vercel-production.yml when any earlier step fails.
import { notifyDeployFailure } from "./lib/deploy-failure.mjs";

await notifyDeployFailure();
