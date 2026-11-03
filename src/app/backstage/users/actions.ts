"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getDb, schema } from "@/db";
import { teamAccess } from "@/lib/access";
import { getAuth } from "@/lib/auth";
import { sendAccountInviteEmail } from "@/lib/email";
import { listRoles, setUserRole } from "@/lib/permission-store";
import { PERMISSIONS } from "@/lib/permissions";
import {
  ensureAccount,
  findAccount,
  invalidateSchedule,
} from "@/lib/schedule-store";

export type Result = { error?: string };

const message = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

// Role and ban changes go through Better Auth's admin plugin, which only lets
// `user.role = 'admin'` accounts make them (roles and per-permission grants
// are on the profile page). Changing your own row is refused so the last
// admin can't lock everyone out.
async function refused(userId: string): Promise<Result | null> {
  const access = await teamAccess();
  if (!access?.admin) return { error: "Only an admin account can do that." };
  if (access.session.user.id === userId) {
    return { error: "You can't change your own access." };
  }
  return null;
}

export async function setRole(
  userId: string,
  role: "user" | "admin",
): Promise<Result> {
  const error = await refused(userId);
  if (error) return error;
  try {
    await getAuth().api.setRole({
      body: { userId, role },
      headers: await headers(),
    });
  } catch (err) {
    return { error: message(err) };
  }
  revalidatePath("/backstage/users");
  return {};
}

export async function setBanned(
  userId: string,
  banned: boolean,
): Promise<Result> {
  const error = await refused(userId);
  if (error) return error;
  const requestHeaders = await headers();
  try {
    if (banned) {
      await getAuth().api.banUser({
        body: { userId },
        headers: requestHeaders,
      });
    } else {
      await getAuth().api.unbanUser({
        body: { userId },
        headers: requestHeaders,
      });
    }
  } catch (err) {
    return { error: message(err) };
  }
  revalidatePath("/backstage/users");
  return {};
}

/**
 * Hard delete: sessions, accounts, the profile, roles and grants cascade with
 * the user row. Straight from the table because Better Auth's removeUser is
 * admin-only and `users.delete` holders needn't be admins; deleting an admin
 * account still is.
 */
export async function removeUser(userId: string): Promise<Result> {
  const access = await teamAccess();
  if (!access?.permissions.has("users.delete"))
    return { error: "Sign in with an account that can delete users." };
  if (access.session.user.id === userId)
    return { error: "You can't delete your own account here." };
  try {
    const { user } = schema;
    const [target] = await getDb()
      .select({ role: user.role })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (!target) return { error: "That account is already gone." };
    if (target.role === "admin" && !access.admin)
      return { error: "Only an admin can delete an admin account." };
    await getDb().delete(user).where(eq(user.id, userId));
  } catch (err) {
    // session_grades keeps its grader (ON DELETE RESTRICT).
    if (/session_grades|foreign key/i.test(message(err)))
      return {
        error:
          "This account has graded submissions, which keep their grader. Ban it instead, or reassign the grades first.",
      };
    return { error: message(err) };
  }
  invalidateSchedule();
  revalidatePath("/backstage/users");
  return {};
}

export type CreateResult = Result & { userId?: string; existed?: boolean };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * An unverified account from a name and email; the first code sign-in claims
 * it. Roles need users.edit and are bounded like assignRole: nothing you
 * don't hold yourself.
 */
export async function createUser(input: {
  name: string;
  email: string;
  roleIds: string[];
  invite: boolean;
}): Promise<CreateResult> {
  const access = await teamAccess();
  if (!access?.permissions.has("users.create"))
    return { error: "Sign in with an account that creates users." };
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name) return { error: "Give them a name." };
  if (!EMAIL.test(email)) return { error: "That email doesn't look right." };
  const roleIds = [...new Set(input.roleIds)];
  if (roleIds.length > 0 && !access.permissions.has("users.edit"))
    return { error: "Assigning roles needs an account that edits users." };
  try {
    const existing = await findAccount(email);
    if (existing) return { existed: true, userId: existing.userId };
    const roles = roleIds.length > 0 ? await listRoles() : [];
    for (const id of roleIds) {
      const role = roles.find((r) => r.id === id);
      if (!role) return { error: "That role no longer exists." };
      const missing = access.admin
        ? []
        : role.permissions.filter((p) => !access.permissions.has(p));
      if (missing.length > 0)
        return {
          error: `You can't assign ${role.name}: it carries ${missing
            .map((p) => PERMISSIONS[p].label)
            .join(", ")}, which you don't hold.`,
        };
    }
    const { userId } = await ensureAccount(name, email);
    for (const id of roleIds) await setUserRole(userId, id, true);
    revalidatePath("/backstage/users");
    if (input.invite) {
      try {
        await sendAccountInviteEmail({ to: email, name });
      } catch (err) {
        return {
          userId,
          error: `Account created, but the invite didn't send: ${message(err)}`,
        };
      }
    }
    return { userId };
  } catch (err) {
    return { error: message(err) };
  }
}
