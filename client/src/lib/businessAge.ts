/*
 * "5 yrs, 273 days in business" — counted live from the day JVO opened.
 *
 * Everything is evaluated in the office's timezone, not the visitor's, so the
 * number ticks over at midnight in Jonesboro. A customer in Tokyo sees the same
 * count the staff do, instead of being a day ahead.
 */

export const OPENED_ON = { year: 2020, month: 11, day: 6 }; // 6 Nov 2020
export const BUSINESS_TZ = "America/New_York";

type Ymd = { year: number; month: number; day: number };

/** Today's calendar date in `tz`, as plain numbers. */
export function todayIn(tz: string, now: Date = new Date()): Ymd {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

const toUTC = (d: Ymd) => Date.UTC(d.year, d.month - 1, d.day);

/**
 * Whole years elapsed, plus the leftover days since the most recent anniversary.
 * Counting days off the anniversary (rather than dividing a total by 365) keeps
 * it honest across leap years — no drift, no 366th day.
 */
export function yearsAndDaysSince(start: Ymd, today: Ymd): { years: number; days: number } {
  if (toUTC(today) <= toUTC(start)) return { years: 0, days: 0 };

  let years = today.year - start.year;
  // Haven't reached this year's anniversary yet — back one off.
  if (today.month < start.month || (today.month === start.month && today.day < start.day)) {
    years -= 1;
  }

  const anniversary = { ...start, year: start.year + years };
  const days = Math.round((toUTC(today) - toUTC(anniversary)) / 86_400_000);
  return { years, days };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** e.g. "5 yrs, 273 days" */
export function formatBusinessAge(now: Date = new Date()): string {
  const { years, days } = businessAgeParts(now);
  return days ? `${years}, ${days}` : years;
}

/**
 * Same count, split so the years can stay at the same type size as the other
 * trust stats and the days can sit beside them, smaller.
 * `days` is null exactly on an anniversary.
 */
export function businessAgeParts(now: Date = new Date()): { years: string; days: string | null } {
  const { years, days } = yearsAndDaysSince(OPENED_ON, todayIn(BUSINESS_TZ, now));
  return {
    years: `${years} yr${years === 1 ? "" : "s"}`,
    days: days === 0 ? null : plural(days, "day"),
  };
}
