"use server";

import { revalidatePath } from "next/cache";
import { EXPIRED, requireAccess } from "@/lib/admin-auth";
import {
  CHECKIN_MIN_CHARS,
  CHECKIN_QUERY_MAX,
  parseBadgeInput,
  type CheckinAccount,
} from "@/lib/checkin";
import { badgeTakenMessage, deskTicket } from "@/lib/checkin-store";
import { reportError, type ReportChannel } from "@/lib/error-report";
import { searchAccounts } from "@/lib/schedule-store";
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

export type DeskState = { error?: string; done?: string; badge?: number };

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
        return { error: await badgeTakenMessage(badge) };
      if (assigned.reason === "invalid")
        return { error: "Badge numbers are up to four digits." };
      return { error: CLAIM_ERRORS.unknown };
    }
  }

  const result = await checkInTicket(access.userId, paymentId);
  revalidatePath(TOOL);
  if (result.ok)
    return { done: "Checked in", badge: result.ticket.badgeCode ?? undefined };
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

export async function reportProblem(
  _prev: DeskState,
  formData: FormData,
): Promise<DeskState> {
  const access = await manage();
  if (!access) return { error: EXPIRED };
  const text = str(formData, "text", 1200);
  if (!text) return { error: "Say what's wrong first." };
  const kind = str(formData, "kind", 20);
  if (kind !== "technical" && kind !== "human") {
    return { error: "Pick whether this is a technical or a human issue." };
  }
  const channel: ReportChannel = kind === "technical" ? "errors" : "staff";
  const sent = await reportError({
    source: "Check-in desk",
    summary: text,
    channel,
    details: {
      Volunteer: access.name,
      Search: str(formData, "q", CHECKIN_QUERY_MAX),
    },
  });
  if (!sent) {
    return {
      error: `Couldn't send. Grab ${channel === "errors" ? "Brian" : "on-site staff"} directly.`,
    };
  }
  return {
    done:
      channel === "errors"
        ? "Sent to #website-errors. Brian is pinged."
        : "Sent to #staff-issues. On-site staff are pinged.",
  };
}
