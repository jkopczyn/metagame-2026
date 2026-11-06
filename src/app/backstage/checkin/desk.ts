import type { CheckinAccount, CheckinState } from "@/lib/checkin";

/** What a row and its modal show; never the claim code. */
export type DeskTicket = {
  paymentId: string;
  name: string;
  /** The row's second line: the purchase email, the tier, or the place in a pack. */
  subtitle: string;
  purchaserEmail: string | null;
  purchaserName: string | null;
  tier: string;
  badge: number | null;
  state: CheckinState;
  checkedIn: { at: string; by: string } | null;
  /** The account to offer first when claiming: the holder's, else the buyer's. */
  suggested: CheckinAccount | null;
};
