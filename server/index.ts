/*
 * JVO Website server
 * - Serves the built React frontend (dist/public)
 * - Booking API backed by the SAME Google Calendar / service account as JVO Events:
 *     GET  /api/availability?date=YYYY-MM-DD  -> busy blocks for that day
 *     POST /api/book                          -> conflict-check + create event
 *
 * The service-account key lives ONLY on the server (env var GOOGLE_SERVICE_ACCOUNT_JSON),
 * never in the frontend bundle. Calendar is shared with the service account, so it can
 * read free/busy and write events — exactly how the events site does it.
 */
import express from "express";
import { createServer } from "http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { JWT } from "google-auth-library";
import { memberAdminRouter } from "./memberAdmin.js";
import { onboardRouter } from "./memberPortal.js";
import { initMemberScheduler } from "./memberScheduler.js";
import { mountChat } from "./chat.js";
import {
  JVO_OFFICE_CALENDAR_ID,
  TIME_ZONE as DEFAULT_TIME_ZONE,
  OPEN_MINUTES,
  CLOSE_MINUTES,
  MAX_HOURS,
  START_TIMES,
  isOpenDay,
  dayOfWeekFor,
  parseTimeToMinutes,
  validateBookingWindow,
} from "../shared/booking.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The "JVO Office" calendar. No fallback on purpose — if it isn't configured we
// refuse to book rather than write onto whatever calendar was here before.
const CALENDAR_ID = process.env.JVO_CALENDAR_ID || JVO_OFFICE_CALENDAR_ID;
const TIME_ZONE = process.env.JVO_TIMEZONE || DEFAULT_TIME_ZONE;
const CAL_BASE = "https://www.googleapis.com/calendar/v3";

/* ── Service-account auth ─────────────────────────────────────────────── */
function loadServiceAccount(): { client_email: string; private_key: string } | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    try { return JSON.parse(raw); } catch { console.error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON"); return null; }
  }
  const file = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (file && fs.existsSync(file)) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
  }
  return null;
}

let jwtClient: JWT | null = null;
function getClient(): JWT | null {
  if (jwtClient) return jwtClient;
  if (!CALENDAR_ID) {
    console.error("JVO_CALENDAR_ID is not set — booking is disabled.");
    return null;
  }
  const sa = loadServiceAccount();
  if (!sa) return null;
  jwtClient = new JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
  return jwtClient;
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

type FreeBusyCalendar = {
  busy?: { start: string; end: string }[];
  errors?: { domain: string; reason: string }[];
};

async function freeBusy(client: JWT, timeMin: string, timeMax: string) {
  const res = await client.request<{ calendars: Record<string, FreeBusyCalendar> }>({
    url: `${CAL_BASE}/freeBusy`,
    method: "POST",
    data: { timeMin, timeMax, timeZone: TIME_ZONE, items: [{ id: CALENDAR_ID }] },
  });
  const cal = res.data.calendars[CALENDAR_ID];
  /*
   * A calendar the service account can't see comes back 200 with an `errors`
   * array (reason "notFound") and NO busy list. Falling through to [] would
   * read as "the whole day is free" and let us double-book every slot, so a
   * per-calendar error has to be as loud as a failed request.
   */
  if (!cal || cal.errors?.length) {
    const why = cal?.errors?.map((e) => e.reason).join(", ") || "no response for calendar";
    throw new Error(`freeBusy failed for ${CALENDAR_ID}: ${why}`);
  }
  return cal.busy ?? [];
}

/* ── Server ──────────────────────────────────────────────────────────── */
async function startServer() {
  const app = express();
  const server = createServer(app);

  // Visitor chatbot. Brings its own body parser (see chat.ts) so it doesn't
  // depend on being mounted after the global one.
  mountChat(app);

  app.use(express.json());

  // Availability for a given day
  app.get("/api/availability", async (req, res) => {
    const client = getClient();
    if (!client) return res.status(503).json({ error: "Booking is not configured on the server yet." });
    const date = String(req.query.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "date must be YYYY-MM-DD" });
    try {
      const open = isOpenDay(dayOfWeekFor(date));
      if (!open) {
        return res.json({ date, timeZone: TIME_ZONE, open: false, openMinutes: OPEN_MINUTES, closeMinutes: CLOSE_MINUTES, busy: [], busyMinutes: [] });
      }
      const start = wallToInstant(date, 0, 0, TIME_ZONE);
      const end = wallToInstant(date, 24, 0, TIME_ZONE);
      const busy = await freeBusy(client, start.toISOString(), end.toISOString());
      const busyMinutes = busy.map((b) => ({
        start: instantToDayMinutes(new Date(b.start), date),
        end: instantToDayMinutes(new Date(b.end), date),
      }));
      res.json({
        date,
        timeZone: TIME_ZONE,
        open: true,
        openMinutes: OPEN_MINUTES,
        closeMinutes: CLOSE_MINUTES,
        busy,
        busyMinutes,
      });
    } catch (e: any) {
      console.error("availability error", e?.message);
      res.status(502).json({ error: "Could not read the calendar." });
    }
  });

  // The spaces and start times the site actually offers — the API accepts
  // nothing outside these lists, so a scripted POST can't write arbitrary
  // text or absurd time ranges onto the staff calendar.
  const ALLOWED_SPACES = new Set([
    "Classroom (seats 15)",
    "Conference Room (seats 6)",
    "Private Office — Small",
    "Private Office — Large",
    "Content Studio",
    "Corporate Event Space",
  ]);
  // Derived from the shared office hours, not hand-listed — a hand-listed copy
  // silently rejects every slot the moment the hours change.
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
    if (!ALLOWED_SPACES.has(String(space))) {
      return res.status(400).json({ error: "Unknown space." });
    }
    if (!ALLOWED_TIMES.has(String(startTime))) {
      return res.status(400).json({ error: "Unknown start time." });
    }
    const nHours = Number(hours);
    if (!Number.isInteger(nHours) || nHours < 1 || nHours > MAX_HOURS) {
      return res.status(400).json({ error: `Duration must be between 1 and ${MAX_HOURS} hours.` });
    }
    // Office hours are enforced here, not just in the form — the form only
    // decides what to *offer*. Covers the weekday rule, the 9:30–4:30 window,
    // and the date format.
    const outOfHours = validateBookingWindow(String(date), String(startTime), nHours);
    if (outOfHours) return res.status(400).json({ error: outOfHours });

    const run = bookingChain.then(async () => {
    try {
      const startMinutes = parseTimeToMinutes(String(startTime));
      const startInstant = wallToInstant(String(date), Math.floor(startMinutes / 60), startMinutes % 60, TIME_ZONE);
      if (startInstant.getTime() < Date.now() - 60_000) {
        return res.status(400).json({ error: "That date has already passed." });
      }
      const endInstant = new Date(startInstant.getTime() + nHours * 3600 * 1000);

      // Re-check for conflicts right before writing.
      const busy = await freeBusy(client, startInstant.toISOString(), endInstant.toISOString());
      const overlaps = busy.some(
        (b) => new Date(b.start) < endInstant && new Date(b.end) > startInstant
      );
      if (overlaps) {
        return res.status(409).json({ error: "That time was just booked. Please pick another slot." });
      }

      const event = {
        summary: `${space} — ${name}`,
        description:
          `Booked via jonesborovirtualoffice.com\n` +
          `Name: ${name}\nEmail: ${email}\nPhone: ${phone || "—"}\n` +
          `Space: ${space}\nDuration: ${hours} hour(s)\n` +
          (notes ? `Notes: ${notes}\n` : ""),
        start: { dateTime: startInstant.toISOString(), timeZone: TIME_ZONE },
        end: { dateTime: endInstant.toISOString(), timeZone: TIME_ZONE },
      };
      const created = await client.request<{ id: string; htmlLink: string }>({
        url: `${CAL_BASE}/calendars/${encodeURIComponent(CALENDAR_ID)}/events`,
        method: "POST",
        data: event,
      });
      res.json({ ok: true, eventId: created.data.id, htmlLink: created.data.htmlLink });
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
