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
export const MIN_BOOKING_MINUTES = 30;

/** Durations step in half hours, matching the 30-minute slot grid. */
export const DURATION_STEP_HOURS = SLOT_STEP_MINUTES / 60;

/** Longest booking that still fits between opening and closing (7 hours). */
export const MAX_HOURS = Math.floor((CLOSE_MINUTES - OPEN_MINUTES) / 60);

export const HOURS_LABEL = "9:30 AM – 4:30 PM";
export const DAYS_LABEL = "Monday – Friday";

/*
 * ── What can be booked ──────────────────────────────────────────────────────
 * Shared so the form and /api/book agree on the names, the ids, and the hours.
 *
 * The id is what gets stamped onto the calendar event, and it's how we tell
 * "the Classroom is taken" apart from "the whole building is taken" — so once
 * a space has been booked against, don't rename its id.
 *
 * Rentals and tours keep different hours on purpose. A rental has to be out by
 * closing, so 4:00 PM is the last slot a 30-minute booking can start. A tour is
 * staff-led and runs past the door closing, so it gets the 4:30 slot too.
 */
export type Space = {
  id: string;
  name: string;
  /** How to refer to it mid-sentence, when the tile label doesn't read as a noun. */
  noun?: string;
  memberPrice: number;
  nonMemberPrice: number;
  /** Shortest booking this space accepts, in hours. */
  minHours: number;
  /** Set when the length isn't the customer's to choose (tours are always 30 min). */
  fixedHours?: number;
  /** Latest start time offered, in minutes past midnight. */
  lastStartMinutes: number;
  /** Latest a booking of this kind may end, in minutes past midnight. */
  latestEndMinutes: number;
};

const RENTAL = {
  minHours: 0.5,
  lastStartMinutes: 16 * 60, // 4:00 PM — a 30-min rental still ends by 4:30
  latestEndMinutes: CLOSE_MINUTES,
};

export const TOUR_ID = "tour";

export const SPACES: Space[] = [
  { id: "classroom",       name: "Classroom (seats 15)",      memberPrice: 30, nonMemberPrice: 75,  ...RENTAL },
  { id: "conference",      name: "Conference Room (seats 6)", memberPrice: 20, nonMemberPrice: 50,  ...RENTAL },
  { id: "private-small",   name: "Private Office — Small",    memberPrice: 10, nonMemberPrice: 25,  ...RENTAL },
  { id: "private-large",   name: "Private Office — Large",    memberPrice: 15, nonMemberPrice: 35,  ...RENTAL },
  { id: "content-studio",  name: "Content Studio",            memberPrice: 25, nonMemberPrice: 40,  ...RENTAL },
  { id: "corporate-event", name: "Corporate Event Space",     memberPrice: 75, nonMemberPrice: 150, ...RENTAL, minHours: 2 },
  {
    id: TOUR_ID,
    name: "Book a Tour",
    noun: "tour",
    memberPrice: 0,
    nonMemberPrice: 0,
    minHours: 0.5,
    fixedHours: 0.5,
    lastStartMinutes: 16 * 60 + 30, // 4:30 PM
    latestEndMinutes: 17 * 60, // that last tour runs to 5:00
  },
];

/**
 * What a booking costs, in whole dollars. Prices are per hour.
 *
 * The form shows this and the server charges it — but the server recomputes it
 * from its OWN verified member check, never from an amount the browser sent.
 * A price posted by the client is a price the client can edit.
 */
export function priceFor(space: Space, hours: number, isMember: boolean): number {
  const rate = isMember ? space.memberPrice : space.nonMemberPrice;
  return Math.round(rate * hours);
}

/** Whether booking this space requires payment (tours are free). */
export function requiresPayment(space: Space, hours: number, isMember: boolean): boolean {
  return priceFor(space, hours, isMember) > 0;
}

/** Accepts an id ("classroom") or the display name, so older clients still book. */
export function findSpace(idOrName: string): Space | undefined {
  const key = idOrName.trim();
  return SPACES.find((s) => s.id === key || s.name === key);
}

export function isTour(space: Space): boolean {
  return space.id === TOUR_ID;
}

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

/** Hours -> whole minutes, immune to 1.5 * 60 style float dust. */
export function hoursToMinutes(hours: number): number {
  return Math.round(hours * 60);
}

/**
 * Every start time the building offers (9:30 AM … 4:30 PM). This is the
 * superset across all spaces — use `startTimesFor` for what a given space can
 * actually take.
 */
export const START_TIMES: string[] = (() => {
  const latest = Math.max(...SPACES.map((s) => s.lastStartMinutes));
  const out: string[] = [];
  for (let m = OPEN_MINUTES; m <= latest; m += SLOT_STEP_MINUTES) out.push(formatMinutes(m));
  return out;
})();

export const DEFAULT_START_TIME = START_TIMES[0];

/** Longest booking `space` can take starting at `startMinutes`, in hours. */
export function maxHoursAt(space: Space, startMinutes: number): number {
  if (space.fixedHours) return space.fixedHours;
  const room = space.latestEndMinutes - startMinutes;
  return Math.floor(room / SLOT_STEP_MINUTES) * DURATION_STEP_HOURS;
}

/** The start times a booking of `space` for `hours` can still legally use. */
export function startTimesFor(space: Space, hours: number): string[] {
  const length = hoursToMinutes(hours);
  return START_TIMES.filter((t) => {
    const start = parseTimeToMinutes(t);
    return start <= space.lastStartMinutes && start + length <= space.latestEndMinutes;
  });
}

/**
 * Whether a requested booking sits inside office hours.
 * Returns null when it's fine, or a customer-facing reason when it isn't.
 */
export function validateBookingWindow(
  space: Space,
  dateStr: string,
  startTime: string,
  hours: number,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return "Please pick a valid date.";
  if (!isOpenDay(dayOfWeekFor(dateStr))) {
    return `We're open ${DAYS_LABEL} only. Please pick a weekday.`;
  }

  const noun = space.noun ?? space.name;

  if (!Number.isFinite(hours) || hours <= 0) return "Please choose how long you need the space.";
  const length = hoursToMinutes(hours);
  if (length % SLOT_STEP_MINUTES !== 0) return "Bookings are in 30-minute blocks.";
  if (space.fixedHours && hours !== space.fixedHours) {
    return `A ${noun} is ${hoursToMinutes(space.fixedHours)} minutes.`;
  }
  if (length < hoursToMinutes(space.minHours)) {
    return `The ${noun} is booked in ${space.minHours}-hour blocks or longer.`;
  }

  let start: number;
  try {
    start = parseTimeToMinutes(startTime);
  } catch {
    return "Please pick a valid start time.";
  }

  if (start < OPEN_MINUTES) return `Bookings start at ${formatMinutes(OPEN_MINUTES)}.`;
  if (start % SLOT_STEP_MINUTES !== 0) return "Please pick one of the listed start times.";
  if (start > space.lastStartMinutes) {
    return `The latest ${noun} booking starts at ${formatMinutes(space.lastStartMinutes)}.`;
  }
  if (start + length > space.latestEndMinutes) {
    return `Bookings have to end by ${formatMinutes(space.latestEndMinutes)}. Try a shorter booking or an earlier start.`;
  }
  return null;
}
