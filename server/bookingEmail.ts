/*
 * bookingEmail.ts — the two emails a completed reservation sends.
 *
 *   1. Customer confirmation — proof the booking took, with the details they
 *      need to turn up at the right place at the right time.
 *   2. Staff notification    — so the front desk knows someone is coming
 *      without having to watch the calendar.
 *
 * Both reuse the office-brand shell from memberEmail.ts so booking mail looks
 * like the rest of JVO's, and both go out through sendTransactional(), which is
 * deliberately NOT behind MEMBER_EMAILS_ENABLED — see the note there.
 *
 * Nothing in here is allowed to break a booking. The reservation is already on
 * the calendar by the time these run; a mail failure is logged and swallowed.
 */
import {
  escapeHtml,
  shell,
  sendTransactional,
  MAIL_REPLY_TO,
  TEXT_FOOTER,
  type SendResult,
} from "./memberEmail.js";

const OFFICE_ADDRESS = "127 Jonesboro Rd, Jonesboro, GA 30236";
const OFFICE_PHONE = "(678) 519-4723";

export interface BookingDetails {
  name: string;
  email: string;
  phone?: string;
  /** Display name, e.g. "Conference Room (seats 6)" or "Book a Tour". */
  spaceName: string;
  isTour: boolean;
  /** Long form, e.g. "Friday, August 7, 2026". */
  dateLabel: string;
  startTime: string;
  endTime: string;
  durationLabel: string;
  notes?: string;
  htmlLink?: string;
  /** Dollars actually charged through Stripe. Omitted for free bookings. */
  amountPaid?: number;
}

/** Two-column detail rows — the part people actually scan for. */
function detailRows(rows: [string, string | undefined][]): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:22px 0;border-top:1px solid #E5E5E5">
    ${rows
      .filter(([, v]) => v)
      .map(
        ([k, v]) => `<tr>
      <td style="padding:10px 0;border-bottom:1px solid #F0F0F0;font-family:'DM Sans',Arial,sans-serif;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#6B7280;width:38%">${escapeHtml(k)}</td>
      <td style="padding:10px 0;border-bottom:1px solid #F0F0F0;font-family:'DM Sans',Arial,sans-serif;font-size:15px;color:#0A0A0A">${escapeHtml(v)}</td>
    </tr>`
      )
      .join("")}
  </table>`;
}

function plainRows(rows: [string, string | undefined][]): string {
  return rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n");
}

/** Sends both emails. Never throws — returns what happened for logging. */
export async function sendBookingEmails(
  b: BookingDetails
): Promise<{ customer: SendResult | null; staff: SendResult | null }> {
  const when = `${b.dateLabel}, ${b.startTime}–${b.endTime}`;
  const rows: [string, string | undefined][] = [
    [b.isTour ? "Visit" : "Space", b.spaceName],
    ["Date", b.dateLabel],
    ["Time", `${b.startTime} – ${b.endTime}`],
    ["Duration", b.durationLabel],
    // Doubles as the customer's receipt — it's the only confirmation of the
    // charge they get from us, so it belongs above the fold, not in a footer.
    ["Paid", b.amountPaid !== undefined ? `$${b.amountPaid.toFixed(2)}` : undefined],
    ["Notes", b.notes],
  ];

  /* ── Customer ──────────────────────────────────────────────────────── */
  const firstName = (b.name || "there").trim().split(/\s+/)[0];
  const custSubject = b.isTour
    ? `Your JVO tour — ${b.dateLabel}, ${b.startTime}`
    : `Booking confirmed — ${b.spaceName}, ${b.dateLabel}`;

  const custIntro = b.isTour
    ? `Your 30-minute tour of Jonesboro Virtual Office is booked. Come as you are — we'll walk you through the offices, conference room, classroom and studio, and answer whatever you'd like to ask.`
    : `Your reservation is confirmed and on our calendar.`;

  const custText =
    `Hi ${firstName},\n\n${custIntro}\n\n${plainRows(rows)}\n\n` +
    `Where: ${OFFICE_ADDRESS}\n\n` +
    `Need to change or cancel? Reply to this email or call ${OFFICE_PHONE}.` +
    TEXT_FOOTER;

  const custHtml = shell(b.isTour ? "Your Tour is Booked." : "Your Booking is Confirmed.", `
    <p>Hi ${escapeHtml(firstName)},</p>
    <p>${escapeHtml(custIntro)}</p>
    ${detailRows(rows)}
    <p style="margin:0 0 4px"><strong>Where</strong><br>${escapeHtml(OFFICE_ADDRESS)}</p>
    <p style="color:#6B7280;font-size:13px;margin-top:22px">
      Need to change or cancel? Just reply to this email or call ${escapeHtml(OFFICE_PHONE)}.
    </p>`);

  /* ── Staff ─────────────────────────────────────────────────────────── */
  const staffRows: [string, string | undefined][] = [
    ...rows,
    ["Name", b.name],
    ["Email", b.email],
    ["Phone", b.phone || "—"],
  ];
  const staffSubject = `${b.isTour ? "Tour" : "Booking"}: ${b.spaceName} — ${b.dateLabel}, ${b.startTime}`;
  const staffText =
    `${b.name} booked ${b.spaceName}.\n\n${plainRows(staffRows)}\n\n` +
    (b.htmlLink ? `Calendar: ${b.htmlLink}\n` : "") +
    `\n(Automated notification from jonesborovirtualoffice.com.)`;
  const staffHtml = shell(b.isTour ? "New Tour Booked." : "New Booking Received.", `
    <p><strong>${escapeHtml(b.name)}</strong> booked <strong>${escapeHtml(b.spaceName)}</strong> for ${escapeHtml(when)}.</p>
    ${detailRows(staffRows)}
    ${b.htmlLink ? `<p><a href="${escapeHtml(b.htmlLink)}" style="color:#0A0A0A">Open in Google Calendar</a></p>` : ""}
    <p style="color:#6B7280;font-size:13px">Automated notification from jonesborovirtualoffice.com.</p>`);

  // Sent independently: a bad customer address must not cost staff the notice.
  const [customer, staff] = await Promise.all([
    sendTransactional("booking confirmation", {
      to: b.email,
      subject: custSubject,
      text: custText,
      html: custHtml,
    }).catch((e) => {
      console.error("[booking-email] customer send failed:", e?.message);
      return null;
    }),
    sendTransactional("booking staff notice", {
      to: MAIL_REPLY_TO,
      subject: staffSubject,
      text: staffText,
      html: staffHtml,
    }).catch((e) => {
      console.error("[booking-email] staff send failed:", e?.message);
      return null;
    }),
  ]);

  return { customer, staff };
}
