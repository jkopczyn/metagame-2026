"use server";

import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { currentSession, getAuth, hasPassword } from "@/lib/auth";
import { deleteImage, uploadImage } from "@/lib/blob";
import { isMegagameClass, starterLevels } from "@/lib/megagame-levels";
import {
  hasVolunteerLevelEvent,
  loadMegagameLevels,
  recordPickerJoin,
  setMegagameLevels,
} from "@/lib/megagame-store";
import { invalidateSchedule } from "@/lib/schedule-store";
import {
  claimOwnTicket,
  claimTicket,
  normalizeTicketCode,
  ticketLabel,
  unclaimTicket,
} from "@/lib/ticket-store";

export type FormState = { error?: string; saved?: boolean };

async function requireSession() {
  const session = await currentSession();
  if (!session) redirect("/login?next=/account");
  return session;
}

const text = (formData: FormData, key: string, max: number) =>
  String(formData.get(key) ?? "")
    .trim()
    .slice(0, max) || null;

export async function updateProfile(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await requireSession();
  const name = String(formData.get("name") ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80);
  if (!name) return { error: "Enter your name." };

  const values = {
    pronouns: text(formData, "pronouns", 40),
    discordHandle: text(formData, "discordHandle", 40),
    bio: text(formData, "bio", 1000),
    isPublic: formData.get("isPublic") === "on",
  };

  if (name !== session.user.name) {
    await getAuth().api.updateUser({
      body: { name },
      headers: await headers(),
    });
    invalidateSchedule();
  }
  const { profiles } = schema;
  await getDb()
    .insert(profiles)
    .values({ userId: session.user.id, ...values })
    .onConflictDoUpdate({ target: profiles.userId, set: values });

  revalidatePath("/account");
  return { saved: true };
}

export type AvatarResult = { error?: string };

// Upload first, write the row, then delete what was replaced, so a failed
// save never leaves the profile pointing at a deleted file.
async function setAvatar(file: File | null): Promise<AvatarResult> {
  const session = await requireSession();
  const userId = session.user.id;
  const { profiles } = schema;
  const db = getDb();
  const [current] = await db
    .select({ imageUrl: profiles.imageUrl })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);

  let imageUrl: string | null = null;
  if (file) {
    try {
      imageUrl = await uploadImage("profiles", file);
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Upload failed." };
    }
  }
  try {
    await db
      .insert(profiles)
      .values({ userId, imageUrl })
      .onConflictDoUpdate({ target: profiles.userId, set: { imageUrl } });
  } catch (err) {
    await deleteImage(imageUrl);
    throw err;
  }
  if (current?.imageUrl !== imageUrl)
    await deleteImage(current?.imageUrl ?? null);

  revalidatePath("/account");
  return {};
}

export async function saveAvatar(formData: FormData): Promise<AvatarResult> {
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0)
    return { error: "Choose an image." };
  return setAvatar(file);
}

export async function removeAvatar(): Promise<AvatarResult> {
  return setAvatar(null);
}

export type PasswordState = {
  /** "code" swaps the current-password field for an emailed code. */
  mode: "password" | "code";
  error?: string;
  notice?: string;
  saved?: boolean;
};

// Change with the current password, or, having forgotten it, prove the email
// with a code instead. The code reset revokes every session, so this one is
// signed back in afterwards.
export async function savePassword(
  prev: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const session = await requireSession();
  const email = session.user.email;
  const intent = String(formData.get("intent") ?? "change");
  const auth = getAuth();

  if (intent === "cancel") return { mode: "password" };

  if (intent === "send" || intent === "resend") {
    try {
      await auth.api.requestPasswordResetEmailOTP({ body: { email } });
    } catch (e) {
      console.error("[account] sending reset code failed", e);
      return { ...prev, error: "We couldn't send the email. Try again." };
    }
    return {
      mode: "code",
      notice: intent === "resend" ? "Sent a new code." : undefined,
    };
  }

  const fail = (error: string): PasswordState => ({ mode: prev.mode, error });
  const newPassword = String(formData.get("newPassword") ?? "");
  if (newPassword.length < 8) return fail("Use at least 8 characters.");
  if (newPassword !== String(formData.get("confirm") ?? "")) {
    return fail("The passwords don't match.");
  }
  const requestHeaders = await headers();

  if (intent === "reset") {
    const otp = String(formData.get("code") ?? "").replace(/\D/g, "");
    if (otp.length !== 6) return fail("Enter the 6-digit code.");
    try {
      await auth.api.resetPasswordEmailOTP({
        body: { email, otp, password: newPassword },
      });
    } catch (e) {
      const code = e instanceof APIError ? e.body?.code : undefined;
      return fail(
        code === "OTP_EXPIRED"
          ? "That code expired. Send a new one."
          : code === "TOO_MANY_ATTEMPTS"
            ? "Too many tries. Send a new code."
            : "That code didn't match.",
      );
    }
    await auth.api.signInEmail({
      body: { email, password: newPassword },
      headers: requestHeaders,
    });
    revalidatePath("/account");
    return { mode: "password", saved: true };
  }

  try {
    if (await hasPassword(session.user.id)) {
      await auth.api.changePassword({
        body: {
          currentPassword: String(formData.get("currentPassword") ?? ""),
          newPassword,
          revokeOtherSessions: true,
        },
        headers: requestHeaders,
      });
    } else {
      await auth.api.setPassword({
        body: { newPassword },
        headers: requestHeaders,
      });
    }
  } catch (e) {
    if (e instanceof APIError && e.body?.code === "INVALID_PASSWORD") {
      return fail("Your current password is wrong.");
    }
    throw e;
  }

  revalidatePath("/account");
  return { mode: "password", saved: true };
}

export type ClaimState = { error?: string; claimed?: string };

const CLAIM_ERRORS = {
  unknown: "We don't have a ticket with that code. Check it against the email.",
  yours: "That ticket is already yours.",
  already:
    "You already have a ticket. Unclaim it first if you want to use a different one.",
  taken: "Someone else has already claimed that ticket.",
  unpaid: "That ticket's payment hasn't settled yet. Try again later.",
  void: "That ticket's payment didn't go through, so it can't be claimed.",
  limited: "Too many codes that didn't work. Try again in an hour.",
};

export async function claim(
  _prev: ClaimState,
  formData: FormData,
): Promise<ClaimState> {
  const session = await requireSession();
  const code = normalizeTicketCode(String(formData.get("code") ?? ""));
  if (code.length !== 6) return { error: "Codes are 6 characters." };
  const result = await claimTicket(session.user.id, code);
  if (!result.ok) return { error: CLAIM_ERRORS[result.reason] };
  revalidatePath("/account");
  return { claimed: ticketLabel(result.ticket.tier) };
}

/** Claims a ticket the signed-in user bought, by its row rather than its code. */
export async function claimMine(paymentId: string): Promise<ClaimState> {
  const session = await requireSession();
  const result = await claimOwnTicket(
    session.user.id,
    session.user.email,
    paymentId,
  );
  if (!result.ok) return { error: CLAIM_ERRORS[result.reason] };
  revalidatePath("/account");
  return { claimed: ticketLabel(result.ticket.tier) };
}

export type UnclaimState = { error?: string; released?: string };

/** Gives up the signed-in user's spot on a ticket; they keep it under a new code. */
export async function unclaimMine(paymentId: string): Promise<UnclaimState> {
  const session = await requireSession();
  const ticket = await unclaimTicket(session.user.id, paymentId);
  if (!ticket) return { error: "That ticket isn't claimed by you." };
  revalidatePath("/account");
  return { released: ticketLabel(ticket.tier) };
}

export type ClassState = { error?: string };

/**
 * Joins a faction: level 1 in its class, 0 in the others. Picking one you're
 * already in is a no-op, so it can't knock your level back to 1.
 */
export async function chooseMegagameClass(
  _prev: ClassState,
  formData: FormData,
): Promise<ClassState> {
  const session = await requireSession();
  if (await hasVolunteerLevelEvent(session.user.id)) {
    return {
      error:
        "Your class is locked now that a volunteer has recorded a level for you.",
    };
  }
  const chosen = formData.get("class");
  if (!isMegagameClass(chosen)) return { error: "Pick a class." };
  const current = await loadMegagameLevels(session.user.id);
  if (current[chosen] > 0) return {};
  // The audit row goes first so a failed column write never leaves a level with no event.
  await recordPickerJoin(session.user.id, chosen);
  await setMegagameLevels(session.user.id, starterLevels(chosen));
  revalidatePath("/account");
  revalidatePath(`/u/${session.user.id}`);
  return {};
}

export async function signOut(): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/");
}

/** Signs out without redirecting; the nav menu reloads the page itself. */
export async function signOutInPlace(): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() });
}
