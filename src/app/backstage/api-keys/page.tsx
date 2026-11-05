import { desc, eq } from "drizzle-orm";
import { connection } from "next/server";
import KeysPanel, { type KeyRow } from "./KeysPanel";
import { listOwnKeys } from "./own-actions";
import OwnKeysPanel, { type OwnKeyRow } from "./OwnKeysPanel";
import ToolSignIn from "@/components/ToolSignIn";
import { getDb, schema } from "@/db";
import { teamAccess } from "@/lib/access";

const when = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Los_Angeles",
});

export default async function AdminApiKeysPage() {
  await connection();
  const access = await teamAccess();
  const self = access?.permissions.has("api_keys.self") ?? false;
  const manage = access?.permissions.has("api_keys.manage") ?? false;
  if (!self && !manage)
    return <ToolSignIn title="API keys" next="/backstage/api-keys" />;

  const [own, all] = await Promise.all([
    self ? listOwnKeys() : null,
    manage ? listAllKeys() : null,
  ]);

  const ownRows: OwnKeyRow[] | null =
    own?.map((k) => ({
      id: k.id,
      label: k.label,
      start: k.start,
      enabled: k.enabled,
      created: when.format(k.createdAt),
      lastUsed: k.lastRequest ? when.format(k.lastRequest) : null,
    })) ?? null;

  return (
    <div className="space-y-10">
      {ownRows && <OwnKeysPanel rows={ownRows} />}
      {all && (
        <div className="space-y-3">
          <h2 className="font-bebas text-2xl tracking-wide text-navy">
            Everyone’s keys
          </h2>
          <KeysPanel rows={all} />
        </div>
      )}
    </div>
  );
}

async function listAllKeys(): Promise<KeyRow[]> {
  const { apikey, user } = schema;
  const keys = await getDb()
    .select({
      id: apikey.id,
      label: apikey.name,
      start: apikey.start,
      enabled: apikey.enabled,
      createdAt: apikey.createdAt,
      lastRequest: apikey.lastRequest,
      email: user.email,
      owner: user.name,
    })
    .from(apikey)
    .innerJoin(user, eq(user.id, apikey.referenceId))
    .orderBy(desc(apikey.createdAt));

  return keys.map((k) => ({
    id: k.id,
    label: k.label ?? "",
    start: k.start ?? "",
    enabled: k.enabled,
    owner: k.owner.trim() || k.email,
    email: k.email,
    created: when.format(k.createdAt),
    lastUsed: k.lastRequest ? when.format(k.lastRequest) : null,
  }));
}
