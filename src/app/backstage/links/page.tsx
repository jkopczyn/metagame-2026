import { connection } from "next/server";
import AirtableUnavailable from "../AirtableUnavailable";
import SignIn from "../SignIn";
import LinksTool from "./LinksTool";
import { env } from "@/env";
import { toolAccess } from "@/lib/admin-auth";
import { matchLabel } from "@/lib/name-match";
import { siteOriginFromHeaders } from "@/lib/site-origin";
import { listTrackingLinks, loadLinkOptions } from "@/lib/tracking-links";

export default async function AdminLinksPage() {
  // Per-request on every branch, or the sign-in branch gets baked in as
  // static at build time.
  await connection();

  const access = await toolAccess("links.manage");
  if (!access) return <SignIn next="/backstage/links" />;
  if (!env.AIRTABLE_API_KEY)
    return <AirtableUnavailable title="Links" table="Tracking Links" />;

  const [links, options, origin] = await Promise.all([
    listTrackingLinks(),
    loadLinkOptions(),
    siteOriginFromHeaders(),
  ]);
  const me = matchLabel(
    access.name,
    links.map((l) => l.createdBy),
  );
  return <LinksTool links={links} options={options} origin={origin} me={me} />;
}
