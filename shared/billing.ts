/*
 * Billing primitives shared by the invoice ledger and the staff dashboard.
 * ------------------------------------------------------------------------
 * Three things live here because they must agree everywhere they appear — the
 * invoice the customer sees, the Stripe line items they pay, and the row staff
 * read back on the master list:
 *
 *   1. PLANS          what a membership costs, so an invoice can be written
 *                     straight off the "Plan" column of the client master list.
 *   2. cardFeeCents   the card-processing surcharge (3%), charged ON TOP of the
 *                     amount being paid — it never reduces the balance owed.
 *   3. money helpers  one rounding rule, so no two screens disagree by a cent.
 *
 * Prices mirror client/src/components/MembershipsSection.tsx and /pricing. If
 * the price list changes, change it in all three in the same commit.
 */

export interface Plan {
  /** Canonical name, as it should read on an invoice line. */
  name: string;
  /** Monthly price in cents. */
  cents: number;
  /** Extra spellings seen in the wild (sheet entries, Deskworks, old CTAs). */
  aliases?: string[];
}

export const PLANS: Plan[] = [
  { name: "Mail Only Membership", cents: 3900, aliases: ["mail only", "mailonly", "mail"] },
  {
    name: "Business Essential Membership",
    cents: 19900,
    aliases: ["business essential", "business essential solo", "essential", "business"],
  },
  { name: "Team Membership", cents: 45900, aliases: ["team", "team membership"] },
];

/** One-off charges staff commonly add to an invoice, so the amounts stay honest. */
export const ADD_ONS: Plan[] = [
  { name: "Additional Team Member", cents: 7500 },
  { name: "Guest Pass / Walk-In (member)", cents: 1000 },
  { name: "Guest Pass / Walk-In (non-member)", cents: 5000 },
  { name: "Notary Service", cents: 500 },
  { name: "Mailbox Setup / USPS Form 1583 Filing", cents: 0 },
];

/** Lowercase, letters and digits only — "Business Essential (Solo)" -> "businessessentialsolo". */
function squash(s: string): string {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Best match for a free-text plan name, or null. Staff type "Business Essential
 * — $199/mo" in one place and "Essential" in another; both must price the same.
 * Longest alias wins so "team" never shadows a more specific match.
 */
export function findPlan(raw: string): Plan | null {
  const key = squash(raw);
  if (!key) return null;
  let best: { plan: Plan; score: number } | null = null;
  for (const plan of PLANS) {
    for (const candidate of [plan.name, ...(plan.aliases || [])]) {
      const c = squash(candidate);
      if (!c || !key.includes(c)) continue;
      if (!best || c.length > best.score) best = { plan, score: c.length };
    }
  }
  return best?.plan ?? null;
}

/** Monthly price for a plan name, or 0 when we don't recognise it (staff then type the amount). */
export function planPriceCents(raw: string): number {
  return findPlan(raw)?.cents ?? 0;
}

/* ── Card surcharge ───────────────────────────────────────────────────── */

/** Default surcharge percent. Override with CARD_FEE_PERCENT on the server. */
export const DEFAULT_CARD_FEE_PERCENT = 3;

/**
 * The surcharge on a card payment of `amountCents`.
 *
 * Deliberately a straight percentage OF THE PAYMENT, not a gross-up
 * (amount / (1 - rate)): "3% credit card fee" is what the customer is told, so
 * 3% is what they're charged. It is added to the Stripe total as its own line
 * and is NOT credited against the invoice — the balance only ever falls by the
 * amount actually applied to it.
 */
export function cardFeeCents(amountCents: number, percent = DEFAULT_CARD_FEE_PERCENT): number {
  if (!Number.isFinite(amountCents) || amountCents <= 0) return 0;
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  return Math.round((amountCents * percent) / 100);
}

/** "$1,234.56" — the one money format used on invoices, pages, and emails. */
export function formatMoney(cents: number): string {
  const n = (Number(cents) || 0) / 100;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Parse "$1,234.56", "1234.5", "1,234" → cents. Returns null on anything else. */
export function parseMoneyToCents(raw: unknown): number | null {
  const cleaned = String(raw ?? "").replace(/[$,\s]/g, "");
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === "" || cleaned === ".") return null;
  const cents = Math.round(Number(cleaned) * 100);
  return Number.isFinite(cents) ? cents : null;
}

export interface LineItem {
  description: string;
  quantity: number;
  unitCents: number;
}

/** Sum of the line items, in cents. */
export function subtotalCents(items: LineItem[]): number {
  return items.reduce((sum, i) => sum + Math.round(i.quantity * i.unitCents), 0);
}
