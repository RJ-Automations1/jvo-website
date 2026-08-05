/*
 * Booking rules — the single source of truth for the /booking form AND the
 * /api/book endpoint. The form uses these to only *offer* legal slots; the
 * server uses them to *enforce* the same rules, so a hand-crafted POST can't
 * sneak in a Saturday 7pm booking.
 *
 * Office hours: Monday–Friday, 9:30 AM – 4:30 PM (America/New_York).
 */

export const TIME_ZONE = "America/New_York";

/*
 * ⚠️  The "JVO Office" Google Calendar — the one bookings are checked against
 * and written to. Find it in Google Calendar → hover "JVO Office" → ⋮ →
 * Settings and sharing → "Integrate calendar" → Calendar ID.
 *
 * In production this is overridden by the JVO_CALENDAR_ID env var on Render.
 * Never point it at a different calendar to "make bookings work" — the booking
 * API returning "not configured" is the safe failure. Silently writing onto the
 * Outdoor Event Space calendar is not.
 */
export const JVO_OFFICE_CALENDAR_ID =
  "5e39a34a1b48df3ae7baa65d57b57d2ce46e482a040985343617c96dbdc5004e@group.calendar.google.com";

/** Minutes past midnight. */
export const OPEN_MINUTES = 9 * 60 + 30; // 9:30 AM
export const CLOSE_MINUTES = 16 * 60 + 30; // 4:30 PM

/** Open days, matching JS `Date#getDay()` (0 = Sun … 6 = Sat). */
export const OPEN_DAYS = [1, 2, 3, 4, 5];

export const SLOT_STEP_MINUTES = 30;
export const MIN_BOOKING_MINUTES = 60;

/** Longest booking that still ends by closing time (7 hours). */
export const MAX_HOURS = Math.floor((CLOSE_MINUTES - OPEN_MINUTES) / 60);

export const HOURS_LABEL = "9:30 AM – 4:30 PM";
export const DAYS_LABEL = "Monday – Friday";

export function isOpenDay(dayOfWeek: number): boolean {
  return OPEN_DAYS.includes(dayOfWeek);
}

/** Day of week for a YYYY-MM-DD string, read as a plain calendar date. */
export function dayOfWeekFor(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "9:30 AM" -> 570. Throws if it isn't a time we recognise. */
export function parseTimeToMinutes(time: string): number {
  const m = time.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) throw new Error(`Bad time: ${time}`);
  const hour = (+m[1] % 12) + (/pm/i.test(m[3]) ? 12 : 0);
  return hour * 60 + +m[2];
}

/** 570 -> "9:30 AM" */
export function formatMinutes(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(minutes % 60).padStart(2, "0");
  return `${h12}:${mm} ${h24 < 12 ? "AM" : "PM"}`;
}

/** Every start time the office offers (9:30 AM … 3:30 PM). */
export const START_TIMES: string[] = (() => {
  const out: string[] = [];
  for (let m = OPEN_MINUTES; m + MIN_BOOKING_MINUTES <= CLOSE_MINUTES; m += SLOT_STEP_MINUTES) {
    out.push(formatMinutes(m));
  }
  return out;
})();

export const DEFAULT_START_TIME = START_TIMES[0];

/** Start times a booking of `hours` can still finish by 4:30 PM. */
export function startTimesFor(hours: number): string[] {
  const length = hours * 60;
  return START_TIMES.filter((t) => parseTimeToMinutes(t) + length <= CLOSE_MINUTES);
}

/** Longest booking that fits between `startTime` and closing. */
export function maxHoursFrom(startTime: string): number {
  return Math.floor((CLOSE_MINUTES - parseTimeToMinutes(startTime)) / 60);
}

/**
 * Whether a requested booking sits inside office hours.
 * Returns null when it's fine, or a customer-facing reason when it isn't.
 */
export function validateBookingWindow(
  dateStr: string,
  startTime: string,
  hours: number,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return "Please pick a valid date.";
  if (!isOpenDay(dayOfWeekFor(dateStr))) {
    return `We're open ${DAYS_LABEL} only. Please pick a weekday.`;
  }

  if (!Number.isFinite(hours) || hours <= 0) return "Please choose how long you need the space.";
  const length = hours * 60;
  if (length < MIN_BOOKING_MINUTES) return "Bookings are one hour minimum.";

  let start: number;
  try {
    start = parseTimeToMinutes(startTime);
  } catch {
    return "Please pick a valid start time.";
  }

  if (start < OPEN_MINUTES) return `Bookings start at ${formatMinutes(OPEN_MINUTES)}.`;
  if (start % SLOT_STEP_MINUTES !== 0) return "Please pick one of the listed start times.";
  if (start + length > CLOSE_MINUTES) {
    return `Bookings have to end by ${formatMinutes(CLOSE_MINUTES)}. Try a shorter booking or an earlier start.`;
  }
  return null;
}
