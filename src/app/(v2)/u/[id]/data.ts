import { eq } from "drizzle-orm";
import { cache } from "react";
import { getDb, schema } from "@/db";
import { can } from "@/lib/access";
import { currentSession } from "@/lib/auth";
import {
  privateProfile,
  profileAccess,
  publicProfileFields,
  type ProfileAccess,
  type PublicProfile,
} from "@/lib/user-profile";

export type ProfileView = {
  profile: PublicProfile;
  /** Which tier let this viewer in; drives the page's notice. */
  access: Exclude<ProfileAccess, "none">;
};

/**
 * The profile page for `id`, or null when this viewer gets a 404. Signed-in
 * only: `isPublic` opens it to other attendees, profiles.view to the team and
 * volunteers, and the owner always sees their own. Anyone else signed in gets
 * the name alone.
 */
export const loadProfileView = cache(
  async (id: string): Promise<ProfileView | null> => {
    const [row] = await getDb()
      .select({ user: schema.user, profile: schema.profiles })
      .from(schema.user)
      .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.user.id))
      .where(eq(schema.user.id, id))
      .limit(1);
    if (!row) return null;

    const [session, viewAll] = await Promise.all([
      currentSession(),
      can("profiles.view"),
    ]);
    const access = profileAccess(row, {
      signedIn: !!session,
      self: !!session && session.user.id === id,
      canViewAll: !!viewAll,
    });
    if (access === "none") return null;
    if (access === "private") return { profile: privateProfile(row), access };
    return { profile: publicProfileFields(row), access };
  },
);
