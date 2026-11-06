"use server";

import { revalidatePath } from "next/cache";
import { EXPIRED, requireAccess } from "@/lib/admin-auth";
import { formatBadgeCode } from "@/lib/badge-code";
import {
  CHECKIN_MIN_CHARS,
  CHECKIN_QUERY_MAX,
  parseBadgeInput,
  type CheckinAccount,
} from "@/lib/checkin";
import { badgeWearer, deskTicket } from "@/lib/checkin-store";
import { sendAccountInviteEmail } from "@/lib/email";
import { reportError } from "@/lib/error-report";
import { ensureAccount, searchAccounts } from "@/lib/schedule-store";
import {
  assignBadgeCode,
  checkInTicket,
  claimTicketFor,
  undoCheckIn,
} from "@/lib/ticket-store";

const TOOL = "/backstage/checkin";

const str = (formData: FormData, key: string, max = 500) =>
  String(formData.get(key) ?? "")
    .trim()
    .slice(0, max);

const manage = () => requireAccess("checkin.manage");

export type DeskState = { error?: string; done?: string };

const CLAIM_ERRORS = {
  unknown: "That ticket no longer exists. Search again.",
  yours: "They already have this ticket.",
  already: "That account already has a ticket, so it can't take another.",
  taken: "Someone else claimed this ticket in the meantime. Search again.",
  unpaid: "That ticket hasn't been paid for.",
  void: "That ticket's payment didn't go through.",
  checkedIn: "That ticket is already checked in.",
  limited: "Too many attempts. Try again in an hour.",
};

async function takenMessage(code: number): Promise<string> {
  const wearer = await badgeWearer(code);
  return `Badge ${formatBadgeCode(code)} is already on ${wearer ?? "another ticket"}.`;
}

/**
 * The arrival flow in one submit: claim the ticket for the chosen account if
 * nobody has, put the sticker number on it, and check it in. A claim that
 * lands before a later step fails stays, since it was right regardless.
 */
export async function arriveAction(
  _prev: DeskState,
  formData: FormData,
): Promise<DeskState> {
  const access = await manage();
  if (!access) return { error: EXPIRED };
  const paymentId = str(formData, "paymentId");
  const forUserId = str(formData, "forUserId");
  const typed = str(formData, "badge", 20);
  const badge = typed === "" ? null : parseBadgeInput(typed);
  if (badge === undefined) {
    return { error: "Badge numbers are up to four digits." };
  }

  const ticket = await deskTicket(paymentId);
  if (!ticket) return { error: CLAIM_ERRORS.unknown };
  if (ticket.checkedInAt) return { error: CLAIM_ERRORS.checkedIn };
  if (ticket.status !== "paid") return { error: CLAIM_ERRORS.unpaid };
  if (badge === null && ticket.badgeCode === null) {
    return { error: "Type the sticker number before checking in." };
  }

  if (ticket.ownerUserId === null) {
    if (!forUserId) return { error: "Pick who this ticket is for first." };
    const claimed = await claimTicketFor(access.userId, paymentId, forUserId);
    if (!claimed.ok) {
      revalidatePath(TOOL);
      return { error: CLAIM_ERRORS[claimed.reason] };
    }
  }

  if (badge !== null && badge !== ticket.badgeCode) {
    const assigned = await assignBadgeCode(paymentId, badge);
    if (!assigned.ok) {
      revalidatePath(TOOL);
      if (assigned.reason === "taken")
        return { error: await takenMessage(badge) };
      if (assigned.reason === "invalid")
        return { error: "Badge numbers are up to four digits." };
      return { error: CLAIM_ERRORS.unknown };
    }
  }

  const result = await checkInTicket(access.userId, paymentId);
  revalidatePath(TOOL);
  if (result.ok) return { done: "Checked in" };
  if (result.reason === "already") return { error: CLAIM_ERRORS.checkedIn };
  if (result.reason === "unpaid") return { error: CLAIM_ERRORS.unpaid };
  if (result.reason === "unclaimed")
    return { error: "The claim didn't stick. Search again and retry." };
  return { error: CLAIM_ERRORS.unknown };
}

export async function undoAction(
  _prev: DeskState,
  formData: FormData,
): Promise<DeskState> {
  if (!(await manage())) return { error: EXPIRED };
  const ticket = await undoCheckIn(str(formData, "paymentId"));
  revalidatePath(TOOL);
  if (!ticket) return { error: "That ticket wasn't checked in." };
  return { done: "Undone" };
}

export async function findAccounts(
  query: string,
): Promise<{ accounts?: CheckinAccount[]; error?: string }> {
  if (!(await manage())) return { error: EXPIRED };
  const q = String(query).trim().slice(0, CHECKIN_QUERY_MAX);
  if (q.length < CHECKIN_MIN_CHARS) return { accounts: [] };
  const found = await searchAccounts(q, { banned: false });
  return {
    accounts: found.map(({ userId, name, email }) => ({
      id: userId,
      name,
      email,
    })),
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * An account for someone at the desk with none. Unverified and passwordless,
 * like a host invite: their first code sign-in claims it, and the invite
 * email tells them how.
 */
export async function mintAccount(input: {
  name: string;
  email: string;
}): Promise<{ account?: CheckinAccount; error?: string }> {
  if (!(await manage())) return { error: EXPIRED };
  const name = String(input.name).trim().slice(0, 200);
  const email = String(input.email).trim().toLowerCase().slice(0, 254);
  if (!name)
    return { error: "Type their name as it should read on the badge." };
  if (!EMAIL.test(email)) return { error: "That email doesn't look right." };
  const {
    userId,
    name: storedName,
    email: storedEmail,
  } = await ensureAccount(name, email);
  sendAccountInviteEmail({ to: storedEmail, name: storedName }).catch((err) =>
    console.error("[checkin] invite email failed", storedEmail, err),
  );
  return { account: { id: userId, name: storedName, email: storedEmail } };
}

export async function reportProblem(
  _prev: DeskState,
  formData: FormData,
): Promise<DeskState> {
  const access = await manage();
  if (!access) return { error: EXPIRED };
  const text = str(formData, "text", 1200);
  if (!text) return { error: "Say what's wrong first." };
  await reportError({
    source: "Check-in desk",
    summary: text,
    details: {
      Volunteer: access.name,
      Search: str(formData, "q", CHECKIN_QUERY_MAX),
      Ticket: str(formData, "paymentId"),
    },
  });
  return { done: "Sent to Brian and Sparr." };
}
