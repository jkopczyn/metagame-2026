import { formatReferralCode } from "@/lib/referral";
import { formatBadgeCode } from "@/lib/badge-code";
import { formatTicketCode } from "@/lib/ticket-code-format";
import {
  emailKey,
  holdsTicket,
  ticketLabel,
  type TicketRow,
} from "@/lib/ticket-store";

export type TicketView = {
  id: string;
  tier: string;
  status: TicketRow["status"];
  test: boolean;
  /** Claimed by the signed-in user. */
  mine: boolean;
  claimed: boolean;
  /** Set while the signed-in user holds it unclaimed; a claimed code is dead. */
  code: string | null;
  /** Bought by the signed-in user, now held by someone else. */
  transferred: boolean;
  /** The code to invite friends with, once minted for the holder or owner. */
  referralCode: string | null;
  /** Who the ticket was bought on a referral from, by name or email. */
  referredBy: string | null;
  /** Four-digit badge number, shown to the owner once the ticket has one. */
  badgeCode: string | null;
  checkedIn: boolean;
};

export function ticketView(
  t: TicketRow,
  userId: string,
  email: string,
  referredBy: string | null = null,
): TicketView {
  const holds = holdsTicket(t, userId, email);
  const claimed = t.ownerUserId !== null;
  const mine = t.ownerUserId === userId;
  return {
    id: t.paymentId,
    tier: ticketLabel(t.tier),
    status: t.status,
    test: t.test,
    mine,
    claimed,
    code: holds && !claimed ? formatTicketCode(t.ticketCode) : null,
    transferred: !holds && !mine && t.purchaserEmail === emailKey(email),
    referralCode:
      (holds || mine) && t.referralCode !== null
        ? formatReferralCode(t.referralCode)
        : null,
    referredBy,
    badgeCode:
      mine && t.badgeCode !== null ? formatBadgeCode(t.badgeCode) : null,
    checkedIn: mine && t.checkedInAt !== null,
  };
}
