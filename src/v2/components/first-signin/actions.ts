"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getDb, schema } from "@/db";
import { currentSession, getAuth } from "@/lib/auth";
import { cleanDiscordHandle } from "@/lib/discord-handle";
import { invalidateSchedule } from "@/lib/schedule-store";

export type FirstSigninState = { error?: string; saved?: boolean };

const yesNo = (formData: FormData, key: string) => {
  const v = formData.get(key);
  return v === "yes" ? true : v === "no" ? false : null;
};

export async function saveFirstSignin(
  _prev: FirstSigninState,
  formData: FormData,
): Promise<FirstSigninState> {
  const session = await currentSession();
  if (!session) return { error: "You've been signed out. Sign in again." };
  const isAdult = yesNo(formData, "isAdult");
  const bringingChildren = yesNo(formData, "bringingChildren");
  const name = String(formData.get("preferredName") ?? "")
    .trim()
    .slice(0, 80);
  if (isAdult === null || bringingChildren === null || !name)
    return { error: "Fill in the required fields." };

  const values = {
    isAdult,
    bringingChildren,
    discordHandle:
      cleanDiscordHandle(String(formData.get("discordHandle") ?? ""))?.slice(
        0,
        40,
      ) ?? null,
    isPublic: formData.get("isPublic") === "on",
    shareWithRecruiters: formData.get("shareWithRecruiters") === "on",
  };
  const { profiles } = schema;
  await getDb()
    .insert(profiles)
    .values({ userId: session.user.id, ...values })
    .onConflictDoUpdate({ target: profiles.userId, set: values });
  if (name !== session.user.name) {
    await getAuth().api.updateUser({
      body: { name },
      headers: await headers(),
    });
    invalidateSchedule();
  }
  revalidatePath("/account");
  return { saved: true };
}
