import { headers } from "next/headers";
import { cache } from "react";
import { accountsConfigured, getAuth, type Session } from "./auth";
import { userAccess } from "./permission-store";
import {
  effectivePermissions,
  hasTeamPermission,
  PERMISSION_KEYS,
  type Permission,
} from "./permissions";

export type TeamAccess = {
  session: Session;
  /** `user.role = 'admin'`: the superuser bypass, which holds every permission. */
  admin: boolean;
  /** Holds a team-tool permission, so /backstage has something to show. */
  team: boolean;
  permissions: Set<Permission>;
};

/**
 * The signed-in account with its effective permissions, or null when there
 * is no account, it's banned, or it holds no permission at all. Reads the
 * database, not the cookie cache, so a revoke or ban applies at once; and
 * never throws, so the password fallback survives a database outage.
 */
export const teamAccess = cache(async (): Promise<TeamAccess | null> => {
  if (!accountsConfigured()) return null;
  try {
    const session = await getAuth().api.getSession({
      headers: await headers(),
      // disableRefresh keeps this read from writing cookies: a cookie set during
      // a server action makes Next re-render the whole route behind it.
      // currentSession() still does the refreshing.
      query: { disableCookieCache: true, disableRefresh: true },
    });
    const user = session?.user;
    if (!user || user.banned) return null;
    const admin = user.role === "admin";
    const permissions = admin
      ? new Set(PERMISSION_KEYS)
      : effectivePermissions(await userAccess(user.id, false));
    if (permissions.size === 0) return null;
    return {
      session,
      admin,
      team: hasTeamPermission(permissions),
      permissions,
    };
  } catch (e) {
    console.error("[auth] access read failed", e);
    return null;
  }
});

/** The session when its account holds `permission`, else null. */
export async function can(permission: Permission): Promise<Session | null> {
  const access = await teamAccess();
  return access?.permissions.has(permission) ? access.session : null;
}
