import { connection } from "next/server";
import AirtableUnavailable from "../AirtableUnavailable";
import SignIn from "../SignIn";
import LinksTool from "./LinksTool";
import { env } from "@/env";
import { toolAccess } from "@/lib/admin-auth";
import { matchLabel } from "@/lib/name-match";
import { siteOriginFromHeaders } from "@/lib/site-origin";
import {
  listTrackingLinks,
  loadLinkOptions,
  type LinkOptions,
  type TrackingLink,
} from "@/lib/tracking-links";

export default async function AdminLinksPage() {
  // Per-request on every branch, or the sign-in branch gets baked in as
  // static at build time.
  await connection();

  const access = await toolAccess("links.manage");
  if (!access) return <SignIn next="/backstage/links" />;
  if (!env.AIRTABLE_API_KEY)
    return <AirtableUnavailable title="Links" table="Tracking Links" />;

  let links: TrackingLink[];
  let options: LinkOptions;
  try {
    [links, options] = await Promise.all([
      listTrackingLinks(),
      loadLinkOptions(),
    ]);
  } catch (err) {
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        Couldn&rsquo;t read the Tracking Links table:{" "}
        {err instanceof Error ? err.message : String(err)}
      </p>
    );
  }
  const origin = await siteOriginFromHeaders();
  const me = matchLabel(
    access.name,
    links.map((l) => l.createdBy),
  );
  return <LinksTool links={links} options={options} origin={origin} me={me} />;
}
