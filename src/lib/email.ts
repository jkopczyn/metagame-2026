import { Resend } from "resend";
import { env } from "@/env";
import { SOCIAL_LINKS } from "@/lib/urls";
import { formatTicketCode } from "@/lib/ticket-code";

let cached: Resend | null = null;

/**
 * Resend client, or null when RESEND_API_KEY isn't set so email sends no-op in
 * local dev (mirroring the Airtable graceful-degrade).
 */
export function getResend(): Resend | null {
  if (cached) return cached;
  const key = env.RESEND_API_KEY;
  if (!key) return null;
  cached = new Resend(key);
  return cached;
}

export const FROM = "Metagame 2026 <tickets@metagame.games>";
const NO_REPLY = "Metagame 2026 <no-reply@metagame.games>";
const TEAM = "team@metagame.games";
export const CORE = "core@metagame.games";
// Email clients load images over the network, so assets must point at the
// deployed site regardless of which environment sent the email.
const SITE = "https://metagame.games";

export type TicketConfirmationEmail = {
  to: string;
  purchaserName?: string;
  tierLabel: string;
  /** Dollars paid (0 for comps). Ignored when btcPaid is set. */
  usdPaid?: number;
  /** Pre-discount price (struck through when it differs from usdPaid). */
  usdFull?: number;
  /** Whole BTC paid — set on BTC purchases, which charge fixed BTC amounts. */
  btcPaid?: number;
  /** Pre-discount BTC price (struck through when it differs from btcPaid). */
  btcFull?: number;
  /** Stripe-hosted receipt page (charge.receipt_url). */
  receiptUrl?: string;
  /** Promotion code redeemed at checkout. */
  discountCode?: string;
  /** 6-char ticket code (dashless; rendered as XXX-XXX). */
  ticketCode?: string;
  /** Set for a day pass: the one admitted day replaces the Fri–Sun dates line. */
  eventDay?: { long: string; ymd: string };
  /** Set when this purchase put the buyer on the mailing list: adds a line saying so, linking here to opt out. */
  mailingListOptOutUrl?: string;
  test?: boolean;
  groupTickets?: { name: string; email: string; code: string }[];
  idempotencyKey?: string;
};

const VENUE = "Lighthaven%2C+2740+Telegraph+Avenue%2C+Berkeley%2C+CA";

function googleCalendarUrl(dates: string) {
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=Metagame+2026&dates=${dates}&ctz=America/Los_Angeles&location=${VENUE}&details=https%3A%2F%2Fmetagame.games`;
}

/** Google all-day events take an exclusive end date. */
function nextYmd(ymd: string) {
  const d = new Date(
    Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8) + 1),
  );
  return d.toISOString().slice(0, 10).replaceAll("-", "");
}

/**
 * Pure template: subject + HTML + text bodies. `assetBase` overrides the asset
 * host for local previews; emails themselves always use the deployed site.
 */
export function renderTicketConfirmationEmail(
  {
    to,
    purchaserName,
    tierLabel,
    usdPaid,
    usdFull,
    btcPaid,
    btcFull,
    receiptUrl,
    discountCode,
    ticketCode,
    eventDay,
    mailingListOptOutUrl,
    test = false,
    groupTickets,
  }: TicketConfirmationEmail,
  assetBase: string = SITE,
) {
  const isBtc = btcPaid != null;
  const discounted = isBtc
    ? btcFull != null && btcFull > btcPaid
    : usdFull != null && usdFull > (usdPaid ?? 0);
  const paid = isBtc ? `\u20BF${btcPaid}` : `$${(usdPaid ?? 0).toFixed(2)}`;
  const full = isBtc ? `\u20BF${btcFull}` : `$${(usdFull ?? 0).toFixed(2)}`;

  const paidLine = `Amount paid: ${paid}${
    discounted
      ? ` (was ${full}` + (discountCode ? `, code ${discountCode})` : ")")
      : ""
  }`;

  const subject = `${test ? "TEST: " : ""}Metagame 2026 ${groupTickets ? "Family & Friends Pack" : "Ticket"}`;
  const escape = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]!,
    );
  const groupHtml = groupTickets
    ? `<p>Your pack includes ${groupTickets.length} separate weekend admissions. We've also emailed each attendee their own code. For attendee changes or refund requests, reply to this email.</p><ul>${groupTickets.map((t) => `<li>${escape(t.name)} (${escape(t.email)}): <strong>${formatTicketCode(t.code)}</strong></li>`).join("")}</ul>`
    : "";
  const groupText = groupTickets
    ? `Your pack includes ${groupTickets.length} separate weekend admissions. We've also emailed each attendee their own code. For attendee changes or refund requests, reply to this email.\n${groupTickets.map((t) => `${t.name} (${t.email}): ${formatTicketCode(t.code)}`).join("\n")}`
    : "";

  // The shipped .ics is the full three-day event, so day passes get only the
  // Google link (scoped to their day).
  const dates = eventDay
    ? {
        label: "Date",
        text: eventDay.long,
        google: googleCalendarUrl(`${eventDay.ymd}/${nextYmd(eventDay.ymd)}`),
        ics: null,
      }
    : {
        label: "Dates",
        text: "Friday, November 6 &ndash; Sunday, November 8, 2026",
        google: googleCalendarUrl("20261106T140000/20261108T210000"),
        ics: `${SITE}/metagame-2026.ics`,
      };

  const html = `
      <div style="display: none; max-height: 0; overflow: hidden;">You're coming to Metagame!</div>
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="text-align: center; margin: 24px 0;">
          <img src="${assetBase}/images/dice_logo.png" alt="METAGAME" width="360" style="max-width: 100%; height: auto;" />
        </div>

        <h1 style="color: #333; text-align: center;">Ready to play.</h1>

        <p>Hi ${purchaserName || "there"},</p>

        <p>Your Metagame 2026 ticket is confirmed. We're excited to see you there!</p>

        <p>Please join <a href="${SOCIAL_LINKS.DISCORD}">our Discord server</a>, where much future relevant communication will take place.</p>

        <p>Have questions? Check out our <a href="${SITE}/#faq">FAQ</a>. More questions? Reply to this email.</p>

        ${mailingListOptOutUrl ? `<p>We've also added you to the Metagame mailing list for news about this and future events &mdash; <a href="${mailingListOptOutUrl}">opt out here</a> if you'd rather not get those.</p>` : ""}

        <p>See you at Metagame 2026!</p>

        <div style="background-color: #f5f5f5; border: 1px solid #ddd; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h2 style="margin-top: 0;">Ticket Details</h2>
          <p><strong>Name:</strong> ${purchaserName || "—"}</p>
          <p><strong>Email:</strong> ${to}</p>
          <p><strong>Type:</strong> ${tierLabel}</p>
          ${groupHtml}
          ${ticketCode ? `<p><strong>Ticket code:</strong> <span style="font-family: monospace; font-size: 15px;">${formatTicketCode(ticketCode)}</span></p>` : ""}
          <p><strong>Amount Paid:</strong> ${discounted ? `<span style="text-decoration: line-through; color: #999;">${full}</span> ` : ""}${paid}${discountCode && discounted ? ` (<strong>${discountCode}</strong>)` : ""}</p>
          ${receiptUrl ? `<p><a href="${receiptUrl}">View your receipt</a></p>` : ""}
        </div>

        <div style="background-color: #f9fafb; border: 1px solid #ddd; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Event Information</h3>
          <p><strong>${dates.label}:</strong> ${dates.text} <span style="font-size: 13px;">(add to calendar: <a href="${dates.google}">Google</a>${dates.ics ? ` &middot; <a href="${dates.ics}">Apple/Outlook</a>` : ""})</span></p>
          <p><strong>Location:</strong> <a href="https://lighthaven.space">Lighthaven</a>, 2740 Telegraph Avenue, Berkeley, CA</p>
        </div>

        <p style="font-size: 12px; color: #aaa; font-style: italic;">This is not a puzzle.</p>

        <div style="text-align: center; margin: 32px 0 16px;">
          <img src="${assetBase}/images/arbor-tree.png" alt="Arbor" width="56" style="height: auto;" />
          <p style="font-size: 12px; color: #888; margin: 8px 0 0; font-style: italic;">&copy; 2026 Arbor</p>
        </div>
      </div>
    `;

  const text = `
Ready to play.

Hi ${purchaserName || "there"},

Your Metagame 2026 ticket is confirmed. We're excited to see you there!

Please join our Discord server, where much future relevant communication will take place: ${SOCIAL_LINKS.DISCORD}

Have questions? Check out our FAQ (${SITE}/#faq). More questions? Reply to this email.
${
  mailingListOptOutUrl
    ? `
We've also added you to the Metagame mailing list for news about this and future events. Opt out here if you'd rather not get those: ${mailingListOptOutUrl}
`
    : ""
}
See you at Metagame 2026!

Ticket Details
- Name: ${purchaserName || "—"}
- Email: ${to}
- Type: ${tierLabel}
${groupText}
${ticketCode ? `- Ticket code: ${formatTicketCode(ticketCode)}` : ""}
- ${paidLine}
${receiptUrl ? `- Receipt: ${receiptUrl}` : ""}

Event Information
- ${dates.label}: ${dates.text.replace("&ndash;", "–")}
- Add to calendar: ${dates.ics ?? dates.google}
- Location: Lighthaven (https://lighthaven.space), 2740 Telegraph Avenue, Berkeley, CA

This is not a puzzle.

© 2026 Arbor
    `.trim();

  return { subject, html, text };
}

export async function sendTicketConfirmationEmail(
  data: TicketConfirmationEmail,
) {
  const resend = getResend();
  if (!resend) {
    console.warn(
      `[email] Resend not configured — confirmation not sent: ${data.to}`,
    );
    return { sent: false as const, reason: "resend-not-configured" };
  }

  const { subject, html, text } = renderTicketConfirmationEmail(data);
  const { error } = await resend.emails.send(
    {
      from: FROM,
      to: data.to,
      bcc: [CORE],
      replyTo: [TEAM],
      subject,
      html,
      text,
    },
    data.idempotencyKey ? { idempotencyKey: data.idempotencyKey } : undefined,
  );

  if (error) throw new Error(`Resend send failed: ${error.message}`);
  return { sent: true as const };
}

/** Notify the team of a backend failure; no-ops (with a warn) when unconfigured. */
export async function sendAdminErrorEmail(errorMessage: string) {
  const resend = getResend();
  if (!resend) {
    console.warn(
      `[email] Resend not configured — admin error not sent: ${errorMessage}`,
    );
    return;
  }
  await resend.emails.send({
    from: FROM,
    to: [TEAM],
    subject: "**URGENT** METAGAME Admin Error",
    html: `<p>An error occurred: ${errorMessage}</p>`,
  });
}

export const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export type ContactMessage = {
  /** Recipient — the caller has already checked it against the allowed set. */
  to: string;
  name: string;
  email: string;
  subject?: string;
  message: string;
};

/** Site contact form → team inbox, reply-to the sender. Resolves false when Resend isn't configured. */
export async function sendContactEmail({
  to,
  name,
  email,
  subject,
  message,
}: ContactMessage): Promise<boolean> {
  const resend = getResend();
  if (!resend) {
    console.warn(
      `[email] Resend not configured — contact message not sent:\n${JSON.stringify({ to, name, email, subject, message }, null, 2)}`,
    );
    return false;
  }
  const line = subject?.trim() || "Website contact form";
  const { error } = await resend.emails.send({
    // From the team inbox so reply-all reaches the group as well as the sender.
    from: `Metagame Website <${TEAM}>`,
    to: [to],
    replyTo: [email],
    subject: `[Contact] ${line}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="text-align: center; margin: 24px 0 8px;">
          <img src="${SITE}/images/dice_logo.png" alt="METAGAME" width="240" style="max-width: 100%; height: auto;" />
        </div>
        <h1 style="color: #333; text-align: center; font-size: 22px;">Website Contact Form Submitted</h1>
        <p style="color: #888; font-size: 13px; text-align: center;">Reply to this email to answer them.</p>
        <table style="border-collapse: collapse; margin: 20px 0; font-size: 15px;">
          <tr><td style="padding: 4px 12px 4px 0; color: #888;">Name</td><td style="padding: 4px 0;">${escapeHtml(name)}</td></tr>
          <tr><td style="padding: 4px 12px 4px 0; color: #888;">Email</td><td style="padding: 4px 0;">${escapeHtml(email)}</td></tr>
          <tr><td style="padding: 4px 12px 4px 0; color: #888;">Subject</td><td style="padding: 4px 0;">${escapeHtml(line)}</td></tr>
        </table>
        <div style="background-color: #f5f5f5; border: 1px solid #ddd; padding: 16px 20px; border-radius: 8px; white-space: pre-wrap;">${escapeHtml(message)}</div>
      </div>
    `,
    text: `Website Contact Form Submitted\nReply to this email to answer them.\n\nName: ${name}\nEmail: ${email}\nSubject: ${line}\n\n${message}`,
  });
  if (error) throw new Error(error.message);
  return true;
}

export type FormBackup = {
  /** The form's name, e.g. "Volunteer application". */
  form: string;
  /** The Airtable table the row was meant for. */
  table: string;
  /** Why Airtable didn't take it. */
  reason: string;
  /** The person's email, when they gave one. */
  replyTo?: string;
  answers: { label: string; value: string }[];
  files?: { name: string; data: string }[];
};

/**
 * A form submission Airtable didn't take (src/v2/forms), sent to the team
 * inbox so nothing is lost: someone adds it to the table by hand and fixes
 * whatever broke. Resolves false when Resend isn't configured.
 */
export async function sendFormBackupEmail({
  form,
  table,
  reason,
  replyTo,
  answers,
  files = [],
}: FormBackup): Promise<boolean> {
  const resend = getResend();
  if (!resend) {
    console.warn(
      `[email] Resend not configured — form backup not sent:\n${JSON.stringify({ form, table, reason, answers }, null, 2)}`,
    );
    return false;
  }
  const rows = answers
    .map(
      ({ label, value }) =>
        `<tr><td style="padding: 4px 12px 4px 0; color: #888; vertical-align: top;">${escapeHtml(label)}</td><td style="padding: 4px 0; white-space: pre-wrap;">${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  const note = `Airtable didn't take this ${form.toLowerCase()}, so it came here instead. Please add it to table ${table} by hand, then check the form: ${reason}`;
  const { error } = await resend.emails.send({
    from: `Metagame Website <${TEAM}>`,
    to: [TEAM],
    ...(replyTo ? { replyTo: [replyTo] } : {}),
    subject: `[Form backup] ${form}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
        <h1 style="color: #333; font-size: 22px;">${escapeHtml(form)}: not saved to Airtable</h1>
        <p style="color: #666; font-size: 14px;">${escapeHtml(note)}</p>
        <table style="border-collapse: collapse; margin: 20px 0; font-size: 15px;">${rows}</table>
      </div>
    `,
    text: `${form}: not saved to Airtable\n\n${note}\n\n${answers.map(({ label, value }) => `${label}: ${value}`).join("\n")}`,
    attachments: files.map((f) => ({
      filename: f.name,
      content: Buffer.from(f.data, "base64"),
    })),
  });
  if (error) throw new Error(error.message);
  return true;
}

export type SignInCodeEmail = {
  to: string;
  code: string;
  /** Better Auth's OTP purpose; the copy is the same for all of them. */
  type: "sign-in" | "email-verification" | "forget-password" | "change-email";
};

/** Six-digit sign-in code for /login. Logs the code instead when Resend isn't configured, so local sign-in still works. */
export async function sendSignInCodeEmail({ to, code }: SignInCodeEmail) {
  const resend = getResend();
  if (!resend) {
    console.warn(
      `[email] Resend not configured — sign-in code for ${to}: ${code}`,
    );
    return;
  }
  const { error } = await resend.emails.send({
    from: FROM,
    to,
    replyTo: [TEAM],
    subject: `${code} is your Metagame sign-in code`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <div style="text-align: center; margin: 24px 0;">
          <img src="${SITE}/images/dice_logo.png" alt="METAGAME" width="240" style="max-width: 100%; height: auto;" />
        </div>
        <p>Here's your sign-in code:</p>
        <p style="font-family: monospace; font-size: 32px; letter-spacing: 0.3em; text-align: center; margin: 24px 0;">${code}</p>
        <p>It works for 10 minutes. If you didn't ask for it, ignore this email &mdash; nobody can sign in without the code.</p>
        <p style="font-size: 12px; color: #888;">&copy; 2026 Arbor</p>
      </div>
    `,
    text: `Your Metagame sign-in code is ${code}. It works for 10 minutes.\n\nIf you didn't ask for it, ignore this email — nobody can sign in without the code.`,
  });
  if (error) throw new Error(`Resend send failed: ${error.message}`);
}

/** Tells someone an account was made for them and how to sign in. */
export async function sendAccountInviteEmail({
  to,
  name,
}: {
  to: string;
  name: string;
}) {
  const resend = getResend();
  if (!resend) {
    console.warn(`[email] Resend not configured — account invite for ${to}`);
    return;
  }
  // /login asks for the email first and, with no password on the account
  // yet, sends the code straight away.
  const login = `${SITE}/login`;
  const { error } = await resend.emails.send({
    from: NO_REPLY,
    to,
    replyTo: [TEAM],
    subject: "Your Metagame account",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <div style="text-align: center; margin: 24px 0;">
          <img src="${SITE}/images/dice_logo.png" alt="METAGAME" width="240" style="max-width: 100%; height: auto;" />
        </div>
        <p>Hi ${name},</p>
        <p>An account has been set up for you on metagame.games under this email address.</p>
        <p>To use it, <a href="${login}">sign in here</a>: you'll get a code by email, and can set up a password after.</p>
        <p style="font-size: 12px; color: #aaa; font-style: italic;">This is not a puzzle.</p>
        <p style="font-size: 12px; color: #888; font-style: italic;">&copy; 2026 Metagame LLC</p>
      </div>
    `,
    text: `Hi ${name},\n\nAn account has been set up for you on metagame.games under this email address.\n\nTo use it, sign in at ${login}: you'll get a code by email, and can set up a password after.\n\nThis is not a puzzle.\n© 2026 Metagame LLC`,
  });
  if (error) throw new Error(`Resend send failed: ${error.message}`);
}
