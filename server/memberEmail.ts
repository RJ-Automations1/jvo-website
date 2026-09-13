/**
 * Membership onboarding emails.
 * -----------------------------
 * Office brand (NOT the events brand): near-white background, near-black text,
 * serif headings with the last word italicized, plain professional voice.
 *
 * Delivery is doubly guarded:
 *   1. MEMBER_EMAILS_ENABLED (default "false") — while false every send is a
 *      DRY RUN log line, so the pipeline can run in production without
 *      emailing anyone until Vernon flips the switch.
 *   2. SMTP_USER / SMTP_PASS — when missing the send is skipped gracefully
 *      (never throws, never blocks the pipeline).
 *
 * Env:
 *   SMTP_USER       sending mailbox (Gmail address)
 *   SMTP_PASS       Gmail App Password (not the normal password)
 *   SMTP_HOST       optional, default smtp.gmail.com
 *   SMTP_PORT       optional, default 465 (SSL)
 *   MAIL_FROM       optional, default "Jonesboro Virtual Office <SMTP_USER>"
 *   MAIL_REPLY_TO   optional, default jonesborovirtualoffice@gmail.com — also
 *                   the staff-notification inbox
 *   MEMBER_EMAILS_ENABLED  "true" to actually send (default "false" = dry run)
 */

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const SMTP_PORT = Number(process.env.SMTP_PORT || "465");
const MAIL_FROM =
  process.env.MAIL_FROM || (SMTP_USER ? `Jonesboro Virtual Office <${SMTP_USER}>` : "");
export const MAIL_REPLY_TO = process.env.MAIL_REPLY_TO || "jonesborovirtualoffice@gmail.com";
const EMAILS_ENABLED = String(process.env.MEMBER_EMAILS_ENABLED || "false") === "true";

const OFFICE_ADDRESS = "127 Jonesboro Rd, Suite 100, Jonesboro, GA 30236";
const OFFICE_PHONE = "(678) 519-4723";

let transporter: Transporter | null = null;
function getTransporter(): Transporter | null {
  if (!SMTP_USER || !SMTP_PASS) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465, // 465 = implicit SSL; 587 = STARTTLS
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
}

export function emailConfigured(): boolean {
  return Boolean(SMTP_USER && SMTP_PASS);
}

export interface SendResult {
  configured: boolean;
  sent: boolean;
  dryRun?: boolean;
  skipped?: string;
}

/**
 * Central delivery gate. While MEMBER_EMAILS_ENABLED is false this only logs
 * what WOULD have been sent; with no SMTP creds it skips gracefully.
 */
async function deliver(
  label: string,
  mail: { to: string; subject: string; text: string; html: string }
): Promise<SendResult> {
  const to = (mail.to || "").trim();
  if (!to) return { configured: emailConfigured(), sent: false, skipped: "no recipient" };
  if (!EMAILS_ENABLED) {
    console.log(`[member-email] DRY RUN — would send ${label} → ${to} ("${mail.subject}")`);
    return { configured: emailConfigured(), sent: false, dryRun: true };
  }
  const t = getTransporter();
  if (!t) {
    console.warn(`[member-email] SMTP not configured — skipped ${label} → ${to}`);
    return { configured: false, sent: false };
  }
  await t.sendMail({
    from: MAIL_FROM,
    to,
    replyTo: MAIL_REPLY_TO,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
  console.log(`[member-email] sent ${label} → ${to}`);
  return { configured: true, sent: true };
}

/* ── Shared layout (office brand) ─────────────────────────────────────── */

export function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** "Welcome to Your Virtual Office" → heading with the last word italicized. */
function heading(text: string): string {
  const words = text.trim().split(/\s+/);
  const last = words.pop() || "";
  return `${escapeHtml(words.join(" "))} <em>${escapeHtml(last)}</em>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0"><tr><td style="background:#0A0A0A;border-radius:4px">
    <a href="${escapeHtml(href)}" style="display:inline-block;padding:13px 28px;color:#FFFFFF;font-family:'DM Sans',Arial,Helvetica,sans-serif;font-size:13px;font-weight:600;letter-spacing:1px;text-transform:uppercase;text-decoration:none">${escapeHtml(label)}</a>
  </td></tr></table>`;
}

/** Office-brand page shell: near-white, near-black, serif heading. */
export function shell(headingText: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en"><body style="margin:0;padding:0;background:#FAFAFA">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAFA;padding:32px 14px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border:1px solid #E5E5E5;border-radius:4px">
  <tr><td style="padding:34px 38px 8px;font-family:'DM Sans',Arial,Helvetica,sans-serif;font-size:11px;font-weight:600;letter-spacing:3px;text-transform:uppercase;color:#6B7280">Jonesboro Virtual Office</td></tr>
  <tr><td style="padding:6px 38px 0;font-family:'Cormorant Garamond',Georgia,'Times New Roman',serif;font-size:30px;font-weight:600;color:#0A0A0A;line-height:1.2">${heading(headingText)}</td></tr>
  <tr><td style="padding:16px 38px 34px;font-family:'DM Sans',Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:#1C1C1E">${bodyHtml}</td></tr>
</table>
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%"><tr><td style="padding:18px 8px;font-family:'DM Sans',Arial,Helvetica,sans-serif;font-size:12px;color:#6B7280;text-align:center">
  Jonesboro Virtual Office · ${OFFICE_ADDRESS} · ${OFFICE_PHONE}
</td></tr></table>
</td></tr></table>
</body></html>`;
}

export const TEXT_FOOTER = `\n\nJonesboro Virtual Office\n${OFFICE_ADDRESS}\n${OFFICE_PHONE}\njonesborovirtualoffice@gmail.com`;

function firstName(member: { name?: string | null }): string {
  return ((member.name || "there").trim() || "there").split(/\s+/)[0];
}

const DOC_LABELS: Record<string, string> = {
  license_front: "Driver's license (front)",
  license_back: "Driver's license (back)",
  proof_of_residence: "Proof of residence",
  signed_1583: "Signed USPS Form 1583",
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "2026-08-12T10:30" → "Wednesday, August 12, 2026 at 10:30 AM". */
export function prettyAppointment(appointmentAt: string | null): string {
  const m = String(appointmentAt || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return String(appointmentAt || "").trim();
  const [, y, mo, d, hh, mm] = m;
  const dt = new Date(Date.UTC(+y, +mo - 1, +d));
  let h = Number(hh);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${WEEKDAYS[dt.getUTCDay()]}, ${MONTHS[+mo - 1]} ${+d}, ${y} at ${h}:${mm} ${ampm}`;
}

const BRING_LIST = [
  "Your printed, UNSIGNED USPS Form 1583 (we witness and notarize your signature in person)",
  "The two original ID documents listed on your form: a government photo ID plus proof of your home address",
];

/* ── Senders ──────────────────────────────────────────────────────────── */

/** Welcome + portal link — sent when staff start onboarding. */
export async function sendMemberWelcome(member: any, portalUrl: string): Promise<SendResult> {
  const fn = firstName(member);
  const subject = `Welcome to Jonesboro Virtual Office, let's activate your membership`;
  const text = `Hi ${fn},

Welcome to Jonesboro Virtual Office. Your membership (${member.public_id}) is almost ready. A few quick steps and you'll be fully active.

Your personal onboarding checklist is here:
${portalUrl}

It walks you through:
1. Confirming your contact and business details
2. Uploading your driver's license (front and back)
3. Uploading one proof of residence
4. Preparing your USPS Form 1583 (our online wizard fills it for you)
5. Scheduling your quick in-office visit to sign and notarize

The whole thing takes about ten minutes. No long-term contracts, no surprises: just a professional address that works for your business.

Questions? Reply to this email or call ${OFFICE_PHONE}.${TEXT_FOOTER}`;
  const html = shell("Let's Activate Your Membership.", `
    <p>Hi ${escapeHtml(fn)},</p>
    <p>Welcome to Jonesboro Virtual Office. Your membership <strong>${escapeHtml(member.public_id)}</strong> is almost ready. A few quick steps and you'll be fully active.</p>
    ${button(portalUrl, "Open Your Onboarding Checklist")}
    <p style="margin:0 0 6px"><strong>What the checklist covers:</strong></p>
    <ol style="margin:0 0 16px;padding-left:20px">
      <li>Confirm your contact and business details</li>
      <li>Upload your driver's license (front and back)</li>
      <li>Upload one proof of residence</li>
      <li>Prepare your USPS Form 1583, our online wizard fills it for you</li>
      <li>Schedule your quick in-office visit to sign and notarize</li>
    </ol>
    <p>The whole thing takes about ten minutes. Questions? Just reply to this email or call ${OFFICE_PHONE}.</p>`);
  return deliver("welcome", { to: member.email, subject, text, html });
}

/** Nudge for members who still have documents outstanding. */
export async function sendDocumentReminder(
  member: any,
  missingKinds: string[],
  portalUrl: string
): Promise<SendResult> {
  const fn = firstName(member);
  const items = missingKinds.map((k) => DOC_LABELS[k] || k);
  const needsInfo = !member.info_confirmed_at;
  const listText = [
    ...(needsInfo ? ["Confirm your contact and business details"] : []),
    ...items.map((i) => `Upload: ${i}`),
  ];
  const subject = `A quick reminder: finish activating your JVO membership`;
  const text = `Hi ${fn},

You're close! Your Jonesboro Virtual Office membership (${member.public_id}) just needs a little more from you:

${listText.map((l) => `  • ${l}`).join("\n")}

Pick up right where you left off:
${portalUrl}

Once your documents are in, you'll pick a time for your quick in-office visit and you're done. Reply to this email or call ${OFFICE_PHONE} if you've hit a snag.${TEXT_FOOTER}`;
  const html = shell("You're Almost There.", `
    <p>Hi ${escapeHtml(fn)},</p>
    <p>Your Jonesboro Virtual Office membership <strong>${escapeHtml(member.public_id)}</strong> just needs a little more from you:</p>
    <ul style="margin:0 0 16px;padding-left:20px">${listText.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>
    ${button(portalUrl, "Finish Your Checklist")}
    <p>Once your documents are in, you'll pick a time for your quick in-office visit and you're done. Hit a snag? Just reply or call ${OFFICE_PHONE}.</p>`);
  return deliver("document reminder", { to: member.email, subject, text, html });
}

/** Confirmation of the in-office visit the member just scheduled. */
export async function sendAppointmentConfirmation(member: any): Promise<SendResult> {
  const fn = firstName(member);
  const when = prettyAppointment(member.appointment_at);
  const subject = `Your JVO visit is confirmed for ${when}`;
  const text = `Hi ${fn},

Your in-office visit is confirmed:

${when}
Jonesboro Virtual Office, ${OFFICE_ADDRESS}

Please bring:
${BRING_LIST.map((b) => `  • ${b}`).join("\n")}

The visit takes about 15 minutes. We verify your ID, witness and notarize your Form 1583, and hand you your welcome packet. Need to reschedule? Reply to this email or call ${OFFICE_PHONE}.${TEXT_FOOTER}`;
  const html = shell("Your Visit Is Confirmed.", `
    <p>Hi ${escapeHtml(fn)},</p>
    <p style="border-left:2px solid #0A0A0A;padding:10px 16px;background:#F5F5F5;border-radius:4px">
      <strong>${escapeHtml(when)}</strong><br>Jonesboro Virtual Office<br>${OFFICE_ADDRESS}
    </p>
    <p style="margin:16px 0 6px"><strong>Please bring:</strong></p>
    <ul style="margin:0 0 16px;padding-left:20px">${BRING_LIST.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>
    <p>The visit takes about 15 minutes. We verify your ID, witness and notarize your Form 1583, and hand you your welcome packet. Need to reschedule? Just reply or call ${OFFICE_PHONE}.</p>`);
  return deliver("appointment confirmation", { to: member.email, subject, text, html });
}

/** 24-hours-out reminder for the scheduled visit. */
export async function sendAppointmentReminder(member: any): Promise<SendResult> {
  const fn = firstName(member);
  const when = prettyAppointment(member.appointment_at);
  const subject = `See you tomorrow: your JVO visit (${when})`;
  const text = `Hi ${fn},

A friendly reminder: your in-office visit at Jonesboro Virtual Office is coming up.

${when}
${OFFICE_ADDRESS}

Please bring:
${BRING_LIST.map((b) => `  • ${b}`).join("\n")}

Need to reschedule? Reply to this email or call ${OFFICE_PHONE}.${TEXT_FOOTER}`;
  const html = shell("See You Soon.", `
    <p>Hi ${escapeHtml(fn)},</p>
    <p>A friendly reminder, your in-office visit is coming up:</p>
    <p style="border-left:2px solid #0A0A0A;padding:10px 16px;background:#F5F5F5;border-radius:4px">
      <strong>${escapeHtml(when)}</strong><br>${OFFICE_ADDRESS}
    </p>
    <p style="margin:16px 0 6px"><strong>Please bring:</strong></p>
    <ul style="margin:0 0 16px;padding-left:20px">${BRING_LIST.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>
    <p>Need to reschedule? Just reply or call ${OFFICE_PHONE}.</p>`);
  return deliver("appointment reminder", { to: member.email, subject, text, html });
}

/** Staff asked the member to fix something (with their note). */
export async function sendNeedsCorrection(
  member: any,
  note: string,
  portalUrl: string
): Promise<SendResult> {
  const fn = firstName(member);
  const subject = `One small fix needed on your JVO membership application`;
  const text = `Hi ${fn},

Thanks for your patience. We reviewed your onboarding items for membership ${member.public_id} and need one small fix before we can continue:

${note || "Please see your checklist for details."}

You can update everything here:
${portalUrl}

Reply to this email or call ${OFFICE_PHONE} if anything is unclear. We're happy to help.${TEXT_FOOTER}`;
  const html = shell("One Small Fix Needed.", `
    <p>Hi ${escapeHtml(fn)},</p>
    <p>Thanks for your patience. We reviewed your onboarding items for membership <strong>${escapeHtml(member.public_id)}</strong> and need one small fix before we can continue:</p>
    <p style="border-left:2px solid #0A0A0A;padding:10px 16px;background:#F5F5F5;border-radius:4px">${escapeHtml(note || "Please see your checklist for details.")}</p>
    ${button(portalUrl, "Update Your Checklist")}
    <p>Reply to this email or call ${OFFICE_PHONE} if anything is unclear. We're happy to help.</p>`);
  return deliver("needs correction", { to: member.email, subject, text, html });
}

/** Membership approved → active. */
export async function sendMembershipActive(member: any): Promise<SendResult> {
  const fn = firstName(member);
  const subject = `You're active, welcome to Jonesboro Virtual Office`;
  const text = `Hi ${fn},

It's official: your Jonesboro Virtual Office membership (${member.public_id}) is ACTIVE.

Your business address:
Your Business Name
${OFFICE_ADDRESS}

What happens next:
  • Mail handling: [mail pickup instructions placeholder: we'll notify you through the mailbox app when mail arrives; photo, forward, scan, or shred on request]
  • Member rates on every space: conference room, private offices, classroom, content studio
  • 24/7 member access per your plan

Thanks for choosing us. Your business, elevated.

Questions any time: reply to this email or call ${OFFICE_PHONE}.${TEXT_FOOTER}`;
  const html = shell("You're Active.", `
    <p>Hi ${escapeHtml(fn)},</p>
    <p>It's official: your Jonesboro Virtual Office membership <strong>${escapeHtml(member.public_id)}</strong> is <strong>active</strong>.</p>
    <p style="border-left:2px solid #0A0A0A;padding:10px 16px;background:#F5F5F5;border-radius:4px">
      <strong>Your business address</strong><br>${escapeHtml(member.business_name || member.name || "Your Business Name")}<br>${OFFICE_ADDRESS}
    </p>
    <p style="margin:16px 0 6px"><strong>What happens next:</strong></p>
    <ul style="margin:0 0 16px;padding-left:20px">
      <li>Mail handling: [mail pickup instructions placeholder: we'll notify you through the mailbox app when mail arrives; photo, forward, scan, or shred on request]</li>
      <li>Member rates on every space: conference room, private offices, classroom, content studio</li>
      <li>24/7 member access per your plan</li>
    </ul>
    <p>Thanks for choosing us. Your business, elevated.</p>`);
  return deliver("membership active", { to: member.email, subject, text, html });
}

/**
 * Transactional send — used for booking confirmations.
 *
 * Deliberately NOT gated by MEMBER_EMAILS_ENABLED. That flag exists to hold
 * back the membership pipeline's outbound mail until staff are ready for it;
 * a booking confirmation is a direct reply to something the customer just did,
 * so suppressing it would leave them wondering whether the booking took. Still
 * skips gracefully (never throws) when SMTP is unconfigured.
 */
export async function sendTransactional(
  label: string,
  mail: { to: string; subject: string; text: string; html: string }
): Promise<SendResult> {
  const to = (mail.to || "").trim();
  if (!to) return { configured: emailConfigured(), sent: false, skipped: "no recipient" };
  const t = getTransporter();
  if (!t) {
    console.warn(`[booking-email] SMTP not configured — skipped ${label} → ${to}`);
    return { configured: false, sent: false, skipped: "smtp not configured" };
  }
  await t.sendMail({
    from: MAIL_FROM,
    to,
    replyTo: MAIL_REPLY_TO,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
  console.log(`[booking-email] sent ${label} → ${to}`);
  return { configured: true, sent: true };
}

/** Internal staff notification (new appointment, docs complete, stale member…). */
export async function sendStaffNotification(subject: string, lines: string[]): Promise<SendResult> {
  const text = `${lines.join("\n")}\n\n(Automated notification from the JVO membership pipeline. See /admin for details.)`;
  const html = shell("Membership Pipeline Update.", `
    <p>${lines.map((l) => escapeHtml(l)).join("<br>")}</p>
    <p style="color:#6B7280;font-size:13px">Automated notification from the JVO membership pipeline. See /admin for details.</p>`);
  return deliver("staff notification", { to: MAIL_REPLY_TO, subject, text, html });
}

/* ── Invoicing ────────────────────────────────────────────────────────── */
/*
 * Both of these go out via sendTransactional, NOT the MEMBER_EMAILS_ENABLED
 * gate: one is sent because staff pressed "send invoice", the other is a
 * receipt for money that has just left the customer's card. Silently holding
 * either back would be worse than not offering the button.
 */

export interface InvoiceEmailItem {
  description: string;
  quantity: number;
  unitCents: number;
}

function money(cents: number): string {
  const n = (Number(cents) || 0) / 100;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The invoice itself, with the pay link. */
export async function sendInvoiceIssued(args: {
  to: string;
  name: string;
  invoiceNumber: string;
  items: InvoiceEmailItem[];
  subtotalCents: number;
  balanceCents: number;
  dueDate: string;
  memo: string;
  payUrl: string;
  allowPartial: boolean;
  minPaymentCents: number;
  cardFeePercent: number;
}): Promise<SendResult> {
  const fn = (args.name || "there").trim().split(/\s+/)[0] || "there";
  const subject = `Invoice ${args.invoiceNumber} from Jonesboro Virtual Office for ${money(args.balanceCents)}`;

  const lineText = args.items
    .map((i) => `  • ${i.description}${i.quantity > 1 ? ` × ${i.quantity}` : ""}: ${money(Math.round(i.quantity * i.unitCents))}`)
    .join("\n");
  const partialText = args.allowPartial
    ? `You can pay it in full, or part of it now and the rest later. The smallest payment we can take is ${money(args.minPaymentCents)}.`
    : `This invoice is payable in full.`;
  const feeText = args.cardFeePercent > 0
    ? `Card payments carry a ${args.cardFeePercent}% processing fee, shown before you confirm. Cash or check at the office carries none.`
    : `No processing fee applies.`;

  const text = `Hi ${fn},

Here is invoice ${args.invoiceNumber} from Jonesboro Virtual Office.

${lineText}

Total: ${money(args.subtotalCents)}
Balance due: ${money(args.balanceCents)}${args.dueDate ? `\nDue: ${args.dueDate}` : ""}
${args.memo ? `\n${args.memo}\n` : ""}
${partialText}

Pay online here:
${args.payUrl}

${feeText}

Questions about anything on it? Just reply to this email.${TEXT_FOOTER}`;

  const rows = args.items
    .map(
      (i) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #F0F0F0">${escapeHtml(i.description)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #F0F0F0;text-align:right;white-space:nowrap">${i.quantity}</td>
        <td style="padding:8px 0;border-bottom:1px solid #F0F0F0;text-align:right;white-space:nowrap">${money(Math.round(i.quantity * i.unitCents))}</td>
      </tr>`,
    )
    .join("");

  const html = shell("Your JVO Invoice.", `
    <p>Hi ${escapeHtml(fn)},</p>
    <p>Here is invoice <strong>${escapeHtml(args.invoiceNumber)}</strong>${args.dueDate ? `, due <strong>${escapeHtml(args.dueDate)}</strong>` : ""}.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:18px 0 8px">
      <tr>
        <th align="left" style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#6B7280;padding-bottom:6px;border-bottom:1px solid #E5E5E5">Item</th>
        <th align="right" style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#6B7280;padding-bottom:6px;border-bottom:1px solid #E5E5E5">Qty</th>
        <th align="right" style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#6B7280;padding-bottom:6px;border-bottom:1px solid #E5E5E5">Amount</th>
      </tr>
      ${rows}
      <tr><td colspan="2" style="padding-top:12px;font-weight:600">Balance due</td>
          <td align="right" style="padding-top:12px;font-weight:600">${money(args.balanceCents)}</td></tr>
    </table>
    ${args.memo ? `<p style="color:#6B7280;font-size:13px">${escapeHtml(args.memo)}</p>` : ""}
    ${button(args.payUrl, "Pay This Invoice")}
    <p style="font-size:13px;color:#6B7280">${escapeHtml(partialText)} ${escapeHtml(feeText)}</p>
    <p>Questions about anything on it? Just reply to this email.</p>`);

  return sendTransactional("invoice issued", { to: args.to, subject, text, html });
}

/** Receipt for one payment — including what, if anything, is still owed. */
export async function sendPaymentReceipt(args: {
  to: string;
  name: string;
  invoiceNumber: string;
  amountCents: number;
  feeCents: number;
  balanceCents: number;
  payUrl: string;
}): Promise<SendResult> {
  const fn = (args.name || "there").trim().split(/\s+/)[0] || "there";
  const charged = args.amountCents + (args.feeCents || 0);
  const settled = args.balanceCents <= 0;
  const subject = settled
    ? `Paid in full: receipt for invoice ${args.invoiceNumber}`
    : `Payment received for invoice ${args.invoiceNumber} (${money(args.balanceCents)} remaining)`;

  const text = `Hi ${fn},

Thank you, we've received your payment on invoice ${args.invoiceNumber}.

Applied to your invoice: ${money(args.amountCents)}${args.feeCents ? `\nCard processing fee:       ${money(args.feeCents)}` : ""}
Charged to your card:      ${money(charged)}

${settled ? "This invoice is now settled in full. Nothing further is owed." : `Remaining balance: ${money(args.balanceCents)}. You can pay the rest whenever suits, from the same link:\n${args.payUrl}`}${TEXT_FOOTER}`;

  const html = shell(settled ? "Paid in Full." : "Payment Received.", `
    <p>Hi ${escapeHtml(fn)},</p>
    <p>Thank you, we've received your payment on invoice <strong>${escapeHtml(args.invoiceNumber)}</strong>.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:16px 0">
      <tr><td style="padding:6px 0">Applied to your invoice</td><td align="right" style="padding:6px 0">${money(args.amountCents)}</td></tr>
      ${args.feeCents ? `<tr><td style="padding:6px 0;color:#6B7280">Card processing fee</td><td align="right" style="padding:6px 0;color:#6B7280">${money(args.feeCents)}</td></tr>` : ""}
      <tr><td style="padding:10px 0 0;font-weight:600;border-top:1px solid #E5E5E5">Charged to your card</td>
          <td align="right" style="padding:10px 0 0;font-weight:600;border-top:1px solid #E5E5E5">${money(charged)}</td></tr>
    </table>
    ${
      settled
        ? `<p>This invoice is now <strong>settled in full</strong>. Nothing further is owed.</p>`
        : `<p>Remaining balance: <strong>${money(args.balanceCents)}</strong>. You can pay the rest whenever suits, from the same link.</p>${button(args.payUrl, "Pay The Balance")}`
    }`);

  return sendTransactional("payment receipt", { to: args.to, subject, text, html });
}

/* ── Mailbox application ──────────────────────────────────────────────── */

/**
 * Welcome the applicant the moment they finish the mailbox application.
 *
 * Until this existed the ONLY email an application produced went to the JVO
 * team — the person who had just handed over their ID, their address and their
 * signature heard nothing at all, and had no written record of what happens
 * next. That silence is what this fixes.
 *
 * Sent via sendTransactional, so MEMBER_EMAILS_ENABLED does NOT hold it back:
 * it answers something the customer did seconds ago, exactly like a booking
 * confirmation. The kill switch exists for the pipeline's *unprompted* mail
 * (reminders, sweeps), not for a receipt.
 */
export async function sendApplicationWelcome(args: {
  to: string;
  firstName: string;
  plan?: string;
  isBusiness: boolean;
  businessName?: string;
  photoIdLabel?: string;
  addressIdLabel?: string;
  registrationUrl: string;
}): Promise<SendResult> {
  const fn = (args.firstName || "there").trim() || "there";
  const planLine = args.plan ? ` for the ${args.plan} plan` : "";
  const subject = `Welcome to Jonesboro Virtual Office, we have your application`;

  const bring = [
    args.photoIdLabel ? `Your ${args.photoIdLabel}` : "Your government photo ID",
    args.addressIdLabel ? `Your ${args.addressIdLabel}` : "Your proof of address",
  ];

  const text = `Hi ${fn},

Welcome to Jonesboro Virtual Office, and thanks for signing up${planLine}.

We have your mailbox application, your photo ID and your proof of address on file${
    args.businessName ? ` for ${args.businessName}` : ""
  }. Your USPS Form 1583 is filled in and waiting here at the office.

WHAT HAPPENS NEXT

1. Finish your registration, if you haven't already:
   ${args.registrationUrl}

2. Stop by the office with the ORIGINAL documents you uploaded:
${bring.map((b) => `   • ${b}`).join("\n")}

3. We'll have your Form 1583 printed and ready. You sign it in front of our
   staff, we witness it and file it with USPS, and we'll assign your suite
   number there and then.

There is nothing for you to print or download. We have the form, so just bring
those two original documents, and we'll take it from there.

We're at ${OFFICE_ADDRESS}, Monday to Friday during business hours.

Questions about any of it? Just reply to this email, or call ${OFFICE_PHONE}.${TEXT_FOOTER}`;

  const html = shell("Welcome to Your Virtual Office.", `
    <p>Hi ${escapeHtml(fn)},</p>
    <p>Welcome to Jonesboro Virtual Office, and thanks for signing up${escapeHtml(planLine)}.</p>
    <p>We have your mailbox application, your photo ID and your proof of address on file${
      args.businessName ? ` for <strong>${escapeHtml(args.businessName)}</strong>` : ""
    }. Your USPS Form 1583 is filled in and waiting here at the office.</p>

    <p style="margin:22px 0 6px"><strong>What happens next</strong></p>
    <ol style="margin:0 0 16px;padding-left:20px">
      <li style="margin-bottom:8px">Finish your registration, if you haven't already, with the button below.</li>
      <li style="margin-bottom:8px">Stop by the office with the <strong>original</strong> documents you uploaded:
        <ul style="margin:6px 0 0;padding-left:18px">
          ${bring.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}
        </ul>
      </li>
      <li>We'll have your Form 1583 printed and ready. You sign it in front of our staff,
          we witness it and file it with USPS, and we'll assign your suite number there and then.</li>
    </ol>

    ${button(args.registrationUrl, "Finish Your Registration")}

    <p style="font-size:13px;color:#6B7280">There's nothing for you to print or download. We have the
    form. Just bring those two original documents and we'll take it from there.</p>

    <p>We're at ${escapeHtml(OFFICE_ADDRESS)}, Monday to Friday during business hours.
    Questions about any of it? Just reply to this email, or call ${OFFICE_PHONE}.</p>`);

  return sendTransactional("application welcome", { to: args.to, subject, text, html });
}
