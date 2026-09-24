/*
 * JVO Website server
 * - Serves the built React frontend (dist/public)
 * - Booking API backed by the SAME Google Calendar / service account as JVO Events:
 *     GET  /api/availability?date=YYYY-MM-DD  -> busy blocks for that day
 *     POST /api/book                          -> conflict-check + create event
 * - Mailbox application intake (see mailboxApplication.ts):
 *     POST /api/mailbox-application           -> file the filled 1583 to Dropbox + notify staff
 *
 * The service-account key lives ONLY on the server (env var GOOGLE_SERVICE_ACCOUNT_JSON),
 * never in the frontend bundle. Calendar is shared with the service account, so it can
 * read free/busy and write events — exactly how the events site does it.
 */
import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { JWT } from "google-auth-library";
import { memberAdminRouter, requireAdmin } from "./memberAdmin.js";
import { onboardRouter } from "./memberPortal.js";
import { initMemberScheduler } from "./memberScheduler.js";
import { mountMailboxApplication } from "./mailboxApplication.js";
import { mountChat } from "./chat.js";
import {
  invoicesRouter,
  creditInvoiceCheckoutSession,
  expireInvoiceCheckoutSession,
} from "./invoices.js";
import { getScopedClient } from "./googleAuth.js";
import { sendBookingEmails } from "./bookingEmail.js";
import { verifyMember } from "./memberLookup.js";
import {
  mountBookingPayments,
  pendingHolds,
  paymentsConfigured,
  type ConfirmedBooking,
} from "./bookingPayments.js";
import {
  JVO_OFFICE_CALENDAR_ID,
  TIME_ZONE as DEFAULT_TIME_ZONE,
  OPEN_MINUTES,
  CLOSE_MINUTES,
  MAX_HOURS,
  SLOT_STEP_MINUTES,
  START_TIMES,
  findSpace,
  formatMinutes,
  hoursToMinutes,
  isOpenDay,
  isTour,
  dayOfWeekFor,
  parseTimeToMinutes,
  priceFor,
  validateBookingWindow,
} from "../shared/booking.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-08-07" -> "Friday, August 7, 2026", read as a plain calendar date. */
function longDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[dow]}, ${MONTHS[m - 1]} ${d}, ${y}`;
}

/** 0.5 -> "30 minutes", 1 -> "1 hour", 1.5 -> "1.5 hours". */
function durationLabel(hours: number): string {
  if (hours < 1) return `${hoursToMinutes(hours)} minutes`;
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

// The "JVO Office" calendar. No fallback on purpose — if it isn't configured we
// refuse to book rather than write onto whatever calendar was here before.
const CALENDAR_ID = process.env.JVO_CALENDAR_ID || JVO_OFFICE_CALENDAR_ID;
const TIME_ZONE = process.env.JVO_TIMEZONE || DEFAULT_TIME_ZONE;
const CAL_BASE = "https://www.googleapis.com/calendar/v3";

/* ── Service-account auth (shared with the master sheet — see googleAuth.ts) ── */
function getClient(): JWT | null {
  if (!CALENDAR_ID) {
    console.error("JVO_CALENDAR_ID is not set — booking is disabled.");
    return null;
  }
  return getScopedClient(["https://www.googleapis.com/auth/calendar"]);
}

/* ── Time helpers (DST-correct via Intl) ─────────────────────────────── */
function tzOffsetMs(tz: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value])) as Record<string, string>;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUTC - date.getTime();
}

// Wall-clock time in `tz` -> the exact UTC instant (handles DST).
function wallToInstant(dateStr: string, hour: number, minute: number, tz: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utcGuess = Date.UTC(y, m - 1, d, hour, minute, 0);
  const off = tzOffsetMs(tz, new Date(utcGuess));
  return new Date(utcGuess - off);
}

/*
 * An instant -> minutes past midnight on `dateStr` in the office timezone,
 * clamped to the day. Lets the browser reason about busy blocks in office time
 * without knowing anything about timezones itself.
 */
function instantToDayMinutes(instant: Date, dateStr: string): number {
  const dayStart = wallToInstant(dateStr, 0, 0, TIME_ZONE);
  const mins = Math.round((instant.getTime() - dayStart.getTime()) / 60000);
  return Math.max(0, Math.min(24 * 60, mins));
}

/*
 * ── Per-space busy lookup ────────────────────────────────────────────────────
 * We deliberately read events rather than freeBusy. freeBusy only answers "is
 * the calendar busy", which would make a Classroom booking black out the
 * Conference Room and every other space. Events carry the space id we stamped
 * on them, so each space can be checked on its own.
 *
 * The rule for what blocks what:
 *   - an event tagged with a space id  -> blocks only that space
 *   - anything else on the calendar    -> blocks the whole building
 *
 * That second case is the important one. Staff entries, holidays and real
 * events booked over the phone have no tag, so they close every space for
 * their duration — an all-day entry takes out the whole day, which is what we
 * want. Untagged means "assume the worst", never "assume it's free".
 */
const SPACE_PROP = "jvoSpace";

type CalEvent = {
  id?: string;
  status?: string;
  transparency?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
};

/*
 * A calendar the service account can't see returns 404 here, which throws — the
 * caller turns that into a 502. Never soften this into an empty list: "we
 * couldn't read the calendar" would then read as "the whole day is free" and we
 * would double-book every slot.
 */
async function listEvents(client: JWT, timeMin: string, timeMax: string): Promise<CalEvent[]> {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    timeZone: TIME_ZONE,
    singleEvents: "true", // expand recurring events into their occurrences
    orderBy: "startTime",
    maxResults: "2500",
  });
  const res = await client.request<{ items?: CalEvent[] }>({
    url: `${CAL_BASE}/calendars/${encodeURIComponent(CALENDAR_ID)}/events?${params}`,
    method: "GET",
  });
  return (res.data.items ?? []).filter(
    // "Free"-marked entries are notes to staff, not room usage.
    (e) => e.status !== "cancelled" && e.transparency !== "transparent",
  );
}

/** The instants an event occupies, all-day entries included. */
function eventRange(e: CalEvent): { start: Date; end: Date } | null {
  if (e.start?.dateTime && e.end?.dateTime) {
    return { start: new Date(e.start.dateTime), end: new Date(e.end.dateTime) };
  }
  // All-day: date-only, end exclusive. Read as office-local midnights.
  if (e.start?.date && e.end?.date) {
    return {
      start: wallToInstant(e.start.date, 0, 0, TIME_ZONE),
      end: wallToInstant(e.end.date, 0, 0, TIME_ZONE),
    };
  }
  return null;
}

/** Whether `e` takes `spaceId` out of service. A null spaceId means "any space". */
function blocksSpace(e: CalEvent, spaceId: string | null): boolean {
  const tag = e.extendedProperties?.private?.[SPACE_PROP];
  if (!tag) return true; // untagged — treat as the whole building
  return spaceId === null || tag === spaceId;
}

/** Busy intervals for one space on a given window. */
async function busyForSpace(
  client: JWT,
  timeMin: string,
  timeMax: string,
  spaceId: string | null,
): Promise<{ start: Date; end: Date }[]> {
  const events = await listEvents(client, timeMin, timeMax);
  return events
    .filter((e) => blocksSpace(e, spaceId))
    .map(eventRange)
    .filter((r): r is { start: Date; end: Date } => r !== null);
}

/*
 * Everything that occupies a space: what's on the calendar, plus slots being
 * paid for right now. A booking mid-checkout has no calendar event yet (we're
 * pay-first), so without the holds two customers could buy the same slot.
 */
async function occupiedForSpace(
  client: JWT,
  timeMin: string,
  timeMax: string,
  spaceId: string | null,
): Promise<{ start: Date; end: Date }[]> {
  const onCalendar = await busyForSpace(client, timeMin, timeMax, spaceId);
  // A paid hold already has its calendar event, so only the pending ones add
  // anything the calendar doesn't already know about.
  const holds = spaceId ? pendingHolds(spaceId, timeMin, timeMax) : [];
  return [...onCalendar, ...holds];
}

/**
 * Write a confirmed booking to the calendar and send the confirmation emails.
 * Shared by the free path (/api/book, tours) and the paid path (Stripe webhook
 * / return-page reconcile) so both produce byte-identical events.
 */
async function createCalendarBooking(b: ConfirmedBooking): Promise<{ eventId: string; htmlLink: string }> {
  const client = getClient();
  if (!client) throw new Error("calendar not configured");

  const tour = isTour(b.space);
  const startMinutes = parseTimeToMinutes(b.startTime);
  const paidLine =
    b.amountCents > 0
      ? `Paid: $${(b.amountCents / 100).toFixed(2)} via Stripe${b.isMember ? " (member rate)" : ""}\n`
      : "";

  const event = {
    summary: tour ? `Tour — ${b.name}` : `${b.space.name} — ${b.name}`,
    description:
      `Booked via jonesborovirtualoffice.com\n` +
      `Name: ${b.name}\nEmail: ${b.email}\nPhone: ${b.phone || "—"}\n` +
      `${tour ? "Type: Tour" : `Space: ${b.space.name}`}\n` +
      `Duration: ${hoursToMinutes(b.hours)} minutes\n` +
      paidLine +
      (b.notes ? `Notes: ${b.notes}\n` : ""),
    start: { dateTime: b.startInstant.toISOString(), timeZone: TIME_ZONE },
    end: { dateTime: b.endInstant.toISOString(), timeZone: TIME_ZONE },
    /*
     * The tag that makes per-space availability work. Without it this booking
     * would read as "the whole building is taken" to every later check.
     */
    extendedProperties: { private: { [SPACE_PROP]: b.space.id } },
  };

  const created = await client.request<{ id: string; htmlLink: string }>({
    url: `${CAL_BASE}/calendars/${encodeURIComponent(CALENDAR_ID)}/events`,
    method: "POST",
    data: event,
  });

  /*
   * Confirmation mail is fired AFTER the event exists and is never awaited: the
   * booking is already real, so a slow or failing SMTP hop must not delay the
   * customer's confirmation screen or turn a paid reservation into an error.
   */
  void sendBookingEmails({
    name: b.name,
    email: b.email,
    phone: b.phone,
    spaceName: b.space.name,
    isTour: tour,
    dateLabel: longDate(b.dateStr),
    startTime: formatMinutes(startMinutes),
    endTime: formatMinutes(startMinutes + hoursToMinutes(b.hours)),
    durationLabel: durationLabel(b.hours),
    notes: b.notes,
    htmlLink: created.data.htmlLink,
    amountPaid: b.amountCents > 0 ? b.amountCents / 100 : undefined,
    cardFeePaid: b.feeCents > 0 ? b.feeCents / 100 : undefined,
  })
    .then(({ customer, staff }) =>
      console.log(
        `booking email: customer=${customer?.sent ? "sent" : customer?.skipped || "failed"} ` +
        `staff=${staff?.sent ? "sent" : staff?.skipped || "failed"}`,
      ),
    )
    .catch((e) => console.error("booking email failed:", e?.message));

  return { eventId: created.data.id, htmlLink: created.data.htmlLink };
}

/* ── Server ──────────────────────────────────────────────────────────── */
async function startServer() {
  const app = express();
  const server = createServer(app);

  // Mounted BEFORE the global JSON parser: a filled 1583 exceeds express's default
  // 100kb body limit, so this route brings its own parser with a bigger cap.
  mountMailboxApplication(app);

  // Visitor chatbot. Brings its own body parser (see chat.ts) so it doesn't
  // depend on being mounted after the global one.
  mountChat(app);

  /*
   * Stripe. MUST be mounted before express.json(): the webhook verifies a
   * signature over the raw request bytes, and a body that's been parsed and
   * re-serialised no longer matches, so every event would be rejected.
   */
  mountBookingPayments(app, {
    createCalendarBooking,
    hasConflict: async (spaceId, startIso, endIso) => {
      const client = getClient();
      if (!client) throw new Error("calendar not configured");
      const start = new Date(startIso);
      const end = new Date(endIso);
      const busy = await occupiedForSpace(client, startIso, endIso, spaceId);
      return busy.some((b) => b.start < end && b.end > start);
    },
    wallToInstant: (dateStr, hour, minute) => wallToInstant(dateStr, hour, minute, TIME_ZONE),
    // Stripe delivers every event to the one webhook URL, so invoice payments
    // are dispatched from inside it (see invoices.ts).
    invoicePayments: {
      credit: creditInvoiceCheckoutSession,
      expire: expireInvoiceCheckoutSession,
    },
  });

  app.use(express.json());

  // Availability for a given day
  app.get("/api/availability", async (req, res) => {
    const client = getClient();
    if (!client) return res.status(503).json({ error: "Booking is not configured on the server yet." });
    const date = String(req.query.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "date must be YYYY-MM-DD" });

    /*
     * Availability is per space. Callers that don't name one get the
     * conservative answer — everything on the calendar counts as busy — so a
     * missing param can never invent free time that isn't there.
     */
    const spaceParam = String(req.query.space || "");
    const space = spaceParam ? findSpace(spaceParam) : undefined;
    if (spaceParam && !space) return res.status(400).json({ error: "Unknown space." });

    try {
      const open = isOpenDay(dayOfWeekFor(date));
      if (!open) {
        return res.json({ date, space: space?.id ?? null, timeZone: TIME_ZONE, open: false, openMinutes: OPEN_MINUTES, closeMinutes: CLOSE_MINUTES, busyMinutes: [] });
      }
      const start = wallToInstant(date, 0, 0, TIME_ZONE);
      const end = wallToInstant(date, 24, 0, TIME_ZONE);
      const busy = await occupiedForSpace(client, start.toISOString(), end.toISOString(), space?.id ?? null);
      const busyMinutes = busy.map((b) => ({
        start: instantToDayMinutes(b.start, date),
        end: instantToDayMinutes(b.end, date),
      }));
      res.json({
        date,
        space: space?.id ?? null,
        timeZone: TIME_ZONE,
        open: true,
        openMinutes: OPEN_MINUTES,
        closeMinutes: CLOSE_MINUTES,
        busyMinutes,
      });
    } catch (e: any) {
      console.error("availability error", e?.message);
      res.status(502).json({ error: "Could not read the calendar." });
    }
  });

  // The start times the site actually offers — the API accepts nothing outside
  // this list, so a scripted POST can't write absurd time ranges onto the staff
  // calendar. Derived from the shared office hours, not hand-listed: a
  // hand-listed copy silently rejects every slot the moment the hours change.
  // (Spaces are validated the same way, via findSpace.)
  const ALLOWED_TIMES = new Set(START_TIMES);
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Light per-IP throttle: the calendar write is the only unauthenticated
  // mutation on the site, so cap it hard.
  const bookHits = new Map<string, number[]>();
  function throttled(ip: string): boolean {
    const now = Date.now();
    const hits = (bookHits.get(ip) || []).filter((t) => now - t < 60_000);
    hits.push(now);
    bookHits.set(ip, hits);
    return hits.length > 5;
  }

  // Serialize bookings so two simultaneous submits can't both pass the
  // freeBusy check and double-book the same slot (single instance, so an
  // in-process queue is sufficient).
  let bookingChain: Promise<unknown> = Promise.resolve();

  // Create a booking (conflict-checked)
  app.post("/api/book", async (req, res) => {
    const client = getClient();
    if (!client) return res.status(503).json({ error: "Booking is not configured on the server yet." });
    const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?").split(",")[0].trim();
    if (throttled(ip)) return res.status(429).json({ error: "Too many booking attempts. Please wait a minute and try again." });
    const { name, email, phone, space, date, startTime, hours, notes } = req.body || {};
    if (!name || !email || !space || !date || !startTime || !hours) {
      return res.status(400).json({ error: "Missing required booking fields." });
    }
    if (String(name).length > 120 || !EMAIL_RE.test(String(email))) {
      return res.status(400).json({ error: "Please provide a valid name and email." });
    }
    const booked = findSpace(String(space));
    if (!booked) {
      return res.status(400).json({ error: "Unknown space." });
    }
    if (!ALLOWED_TIMES.has(String(startTime))) {
      return res.status(400).json({ error: "Unknown start time." });
    }
    const nHours = Number(hours);
    if (!Number.isFinite(nHours) || nHours <= 0 || nHours > MAX_HOURS || hoursToMinutes(nHours) % SLOT_STEP_MINUTES !== 0) {
      return res.status(400).json({ error: `Duration must be in 30-minute blocks, up to ${MAX_HOURS} hours.` });
    }
    // Office hours are enforced here, not just in the form — the form only
    // decides what to *offer*. Covers the weekday rule, this space's own start
    // and end limits, and the date format.
    const outOfHours = validateBookingWindow(booked, String(date), String(startTime), nHours);
    if (outOfHours) return res.status(400).json({ error: outOfHours });

    /*
     * This route now only books what's FREE — tours. Anything with a price must
     * go through /api/book/checkout and come back via Stripe, or the room would
     * be given away for nothing by anyone POSTing here directly. The member rate
     * is decided by the members table, never by a flag from the browser.
     */
    const member = (await verifyMember(String(email))).member;
    if (priceFor(booked, nHours, member) > 0) {
      return res.status(402).json({
        error: "This space has to be paid for at booking.",
        paymentRequired: true,
      });
    }

    const run = bookingChain.then(async () => {
    try {
      const startMinutes = parseTimeToMinutes(String(startTime));
      const startInstant = wallToInstant(String(date), Math.floor(startMinutes / 60), startMinutes % 60, TIME_ZONE);
      if (startInstant.getTime() < Date.now() - 60_000) {
        return res.status(400).json({ error: "That date has already passed." });
      }
      const endInstant = new Date(startInstant.getTime() + hoursToMinutes(nHours) * 60_000);

      // Re-check for conflicts right before writing — only against what
      // actually occupies THIS space (plus anything untagged, which occupies
      // everything). Another space being busy is not our problem.
      const busy = await occupiedForSpace(
        client, startInstant.toISOString(), endInstant.toISOString(), booked.id,
      );
      const overlaps = busy.some((b) => b.start < endInstant && b.end > startInstant);
      if (overlaps) {
        return res.status(409).json({ error: "That time was just booked. Please pick another slot." });
      }

      const created = await createCalendarBooking({
        name: String(name),
        email: String(email),
        phone: phone ? String(phone) : undefined,
        notes: notes ? String(notes) : undefined,
        space: booked,
        dateStr: String(date),
        startTime: String(startTime),
        hours: nHours,
        startInstant,
        endInstant,
        amountCents: 0, // free — anything priced went through Stripe
        feeCents: 0,
        isMember: member,
      });
      res.json({ ok: true, eventId: created.eventId, htmlLink: created.htmlLink });
    } catch (e: any) {
      console.error("book error", e?.message);
      res.status(502).json({ error: "Could not create the booking. Please try again or call us." });
    }
    });
    bookingChain = run.catch(() => undefined);
    await run;
  });

  // Membership-activation pipeline: staff dashboard (/admin, Basic Auth) and
  // the member onboarding portal (/onboard/:token). Mounted BEFORE the static
  // frontend + SPA fallback so their routes are never swallowed by index.html.
  app.use(memberAdminRouter);
  app.use(onboardRouter);
  // Invoicing: the staff desk at /admin/invoices (same Basic Auth) and the
  // customer's tokenized pay page at /invoice/:token.
  app.use(invoicesRouter(requireAdmin));
  initMemberScheduler();

  // Static frontend (built by Vite to dist/public).
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "..", "public")   // dist/server -> dist/public
      : path.resolve(__dirname, "..", "dist", "public");
  app.use(express.static(staticPath));

  // SPA fallback for client-side routes.
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3000;
  server.listen(port, () => console.log(`Server running on http://localhost:${port}/`));
}

startServer().catch(console.error);
