/**
 * The card-processing surcharge, in one place.
 *
 * Two things charge cards — room bookings (bookingPayments.ts) and membership
 * invoices (invoices.ts) — and they must agree on the rate, so the env read lives
 * here rather than in either of them. It's a server module, not part of
 * shared/billing.ts, because the frontend bundle must never carry a process.env
 * read; the browser gets the authoritative figure from the server's quote instead.
 *
 * CARD_FEE_PERCENT=0 switches the surcharge off everywhere.
 */
import { DEFAULT_CARD_FEE_PERCENT } from "../shared/billing.js";

/** Highest rate we'll honour — a typo'd "300" must never bill someone 4x. */
const MAX_PERCENT = 10;

export function cardFeePercent(): number {
  const raw = process.env.CARD_FEE_PERCENT;
  if (raw === undefined || raw === "") return DEFAULT_CARD_FEE_PERCENT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_CARD_FEE_PERCENT;
  return Math.min(n, MAX_PERCENT);
}
