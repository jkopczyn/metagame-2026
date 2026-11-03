import { CORE, FROM, escapeHtml, getResend } from "@/lib/email";
import { reportError } from "@/lib/error-report";
import { emailSubject, readEmail } from "@/lib/sent-emails";

const TICKET_HOLDERS_SEGMENT_ID = "352cb53c-55e4-48d4-8a11-fa32aaa73f1e";

const OPENER =
  '<p style="margin:0 0 18px;font-size:17px;line-height:1.6;color:#1b1b1b;">We are less than a week out';

export type TicketFollowUp = {
  to: string;
  name?: string;
  ticketType?: string;
  /** Payment id the one-week-out send is idempotent on. */
  paymentId: string;
  test: boolean;
  /** reportError source, e.g. "Stripe webhook". */
  source: string;
};

function splitName(name: string | undefined) {
  const [firstName, ...rest] = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return { firstName, lastName: rest.join(" ") || undefined };
}

/**
 * The EmailOctopus template as a one-to-one send: its merge-tag footer lines
 * go, and a greeting lands above the opening paragraph.
 */
export function renderOneWeekOutEmail(
  source: string,
  firstName: string | undefined,
): { subject: string; html: string } {
  const subject = emailSubject(source, "one-week-out");

  let html = source
    .replace(
      / &#183; <a href="\{\{UnsubscribeURL\}\}"[^>]*>unsubscribe<\/a>/,
      "",
    )
    .replace(/^[ \t]*<p[^>]*>\{\{SenderInfoLine\}\}<\/p>[ \t]*\r?\n/m, "")
    .replace(
      /^[ \t]*<p[^>]*><a href="\{\{RewardsURL\}\}"[^>]*>Powered by EmailOctopus<\/a><\/p>[ \t]*\r?\n/m,
      "",
    );
  const leftover = html.match(/\{\{\w+\}\}/g);
  if (leftover)
    throw new Error(`one-week-out email still has ${leftover.join(", ")}`);

  if (!html.includes(OPENER))
    throw new Error("one-week-out email opening paragraph not found");
  const greeting = `<p style="margin:0 0 18px;font-size:17px;line-height:1.6;color:#1b1b1b;">Hi ${escapeHtml(firstName ?? "") || "there"},</p>`;
  html = html.replace(OPENER, `${greeting}\n${OPENER}`);

  return { subject, html };
}

/**
 * After a paid ticket: the buyer joins the ticket-holders segment and gets
 * the one-week-out logistics email. The two steps run independently and
 * soft-fail through reportError, so they can never break the ticket itself.
 */
export async function followUpTicketPurchase({
  to,
  name,
  ticketType,
  paymentId,
  test,
  source,
}: TicketFollowUp): Promise<void> {
  if (test) return;
  const resend = getResend();
  if (!resend) {
    console.warn(
      `[email] Resend not configured — ticket follow-up skipped: ${to}`,
    );
    return;
  }
  const { firstName, lastName } = splitName(name);
  const errors: string[] = [];

  try {
    const { error } = await resend.contacts.create({
      email: to,
      firstName,
      lastName,
      properties: { ticket_type: ticketType ?? "" },
      segments: [{ id: TICKET_HOLDERS_SEGMENT_ID }],
    });
    if (error) throw new Error(`Resend contact failed: ${error.message}`);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  try {
    const source = await readEmail("one-week-out");
    if (source == null) throw new Error("one-week-out email not found");
    const { subject, html } = renderOneWeekOutEmail(source, firstName);
    const { error } = await resend.emails.send(
      { from: FROM, to, replyTo: [CORE], subject, html },
      { idempotencyKey: `one-week-out/${paymentId}` },
    );
    if (error) throw new Error(`Resend send failed: ${error.message}`);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  if (!errors.length) return;
  const err = new Error(errors.join("; "));
  console.error(`[${source}] ticket follow-up failed:`, err);
  await reportError({
    source,
    summary:
      "Ticket follow-up (Resend contact + one-week-out email) failed (the ticket itself is fine)",
    details: { Buyer: to, Payment: paymentId },
    error: err,
    mention: false,
  });
}
