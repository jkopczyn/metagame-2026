import { neonConfig } from "@neondatabase/serverless";

/** Points Neon's HTTP driver at scripts/local-db-server.mjs for 127.0.0.1 URLs. */
export function routeLocalDatabase(databaseUrl) {
  const { hostname, port } = new URL(databaseUrl);
  if (hostname === "127.0.0.1") {
    neonConfig.fetchEndpoint = `http://${hostname}:${port}/sql`;
  }
}
