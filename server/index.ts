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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CALENDAR_ID =
  process.env.JVO_CALENDAR_ID ||
  "1830514f596a30e51ac9c83a2700e915b87ddd99115031e62d788dde64733d57@group.calendar.google.com";
const TIME_ZONE = process.env.JVO_TIMEZONE || "America/New_York";
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

// "9:00 AM" -> { hour, minute } in 24h
function parseTime(t: string): { hour: number; minute: number } {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) throw new Error(`Bad time: ${t}`);
  let hour = +m[1] % 12;
  if (/pm/i.test(m[3])) hour += 12;
  return { hour, minute: +m[2] };
}

async function freeBusy(client: JWT, timeMin: string, timeMax: string) {
  const res = await client.request<{ calendars: Record<string, { busy: { start: string; end: string }[] }> }>({
    url: `${CAL_BASE}/freeBusy`,
    method: "POST",
    data: { timeMin, timeMax, timeZone: TIME_ZONE, items: [{ id: CALENDAR_ID }] },
  });
  return res.data.calendars[CALENDAR_ID]?.busy ?? [];
}

/* ── Server ──────────────────────────────────────────────────────────── */
async function startServer() {
  const app = express();
  const server = createServer(app);
  app.use(express.json());

  // Availability for a given day
  app.get("/api/availability", async (req, res) => {
    const client = getClient();
    if (!client) return res.status(503).json({ error: "Booking is not configured on the server yet." });
    const date = String(req.query.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "date must be YYYY-MM-DD" });
    try {
      const start = wallToInstant(date, 0, 0, TIME_ZONE);
      const end = wallToInstant(date, 24, 0, TIME_ZONE);
      const busy = await freeBusy(client, start.toISOString(), end.toISOString());
      res.json({ date, timeZone: TIME_ZONE, busy });
    } catch (e: any) {
      console.error("availability error", e?.message);
      res.status(502).json({ error: "Could not read the calendar." });
    }
  });

  // Create a booking (conflict-checked)
  app.post("/api/book", async (req, res) => {
    const client = getClient();
    if (!client) return res.status(503).json({ error: "Booking is not configured on the server yet." });
    const { name, email, phone, space, date, startTime, hours, notes } = req.body || {};
    if (!name || !email || !space || !date || !startTime || !hours) {
      return res.status(400).json({ error: "Missing required booking fields." });
    }
    try {
      const { hour, minute } = parseTime(String(startTime));
      const startInstant = wallToInstant(String(date), hour, minute, TIME_ZONE);
      const endInstant = new Date(startInstant.getTime() + Number(hours) * 3600 * 1000);

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
