import { desc } from "drizzle-orm";
import { connection } from "next/server";
import UsersTable, { type UserRow } from "./UsersTable";
import ToolSignIn from "@/components/ToolSignIn";
import { getDb, schema } from "@/db";
import { teamAccess } from "@/lib/access";
import { listRoles, rolesFor } from "@/lib/permission-store";
import { formatBadgeCode } from "@/lib/badge-code";
import { badgeCodesFor, claimedCounts } from "@/lib/ticket-store";

// Every account comes down and the table sorts, filters and searches in the
// browser; revisit once the list is in the thousands.
const CAP = 2000;

const joined = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "America/Los_Angeles",
});
const joinedExact = new Intl.DateTimeFormat("en-US", {
  dateStyle: "full",
  timeStyle: "long",
  timeZone: "America/Los_Angeles",
});

export default async function AdminUsersPage(
  props: PageProps<"/backstage/users">,
) {
  await connection();

  const access = await teamAccess();
  if (!access?.permissions.has("users.view"))
    return <ToolSignIn title="Users" next="/backstage/users" />;

  const q = String((await props.searchParams).q ?? "").trim();
  // Straight from the table: Better Auth's listUsers is admin-only, and
  // users.view holders needn't be admins.
  const { user } = schema;
  const users = await getDb()
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      role: user.role,
      banned: user.banned,
      createdAt: user.createdAt,
    })
    .from(user)
    .orderBy(desc(user.createdAt))
    .limit(CAP);
  const ids = users.map((u) => u.id);
  const [claimed, badges, held, allRoles] = await Promise.all([
    claimedCounts(ids),
    badgeCodesFor(ids),
    rolesFor(ids),
    listRoles(),
  ]);
  const rows: UserRow[] = users.map((u) => {
    const at = new Date(u.createdAt);
    const badge = badges.get(u.id);
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      emailVerified: u.emailVerified,
      admin: u.role === "admin",
      roles: held.get(u.id) ?? [],
      banned: Boolean(u.banned),
      joined: joined.format(at),
      joinedExact: joinedExact.format(at),
      joinedAt: at.getTime(),
      self: u.id === access.session.user.id,
      tickets: claimed.get(u.id) ?? 0,
      badge: badge === undefined ? null : formatBadgeCode(badge),
    };
  });

  return (
    <UsersTable
      rows={rows}
      initialQuery={q}
      allRoles={allRoles
        .filter((r) => !r.auto)
        .map((r) => ({ id: r.id, name: r.name }))}
      viewerIsAdmin={access.admin}
      viewerCanCreate={access.permissions.has("users.create")}
      viewerCanEdit={access.permissions.has("users.edit")}
      viewerCanDelete={access.permissions.has("users.delete")}
    />
  );
}
