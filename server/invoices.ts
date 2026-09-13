/**
 * Membership invoicing — written up from the client master list, paid through Stripe.
 * ----------------------------------------------------------------------------------
 * Staff routes (Basic Auth, same gate as /admin):
 *   GET  /admin/invoices                      — the invoicing screen
 *   GET  /api/admin/invoicing/clients         — the master list, ready to invoice from
 *   GET  /api/admin/invoices                  — every invoice + live balance
 *   GET  /api/admin/invoices/:id              — one invoice + its payments
 *   POST /api/admin/invoices                  — write one up (optionally email it)
 *   POST /api/admin/invoices/:id/send         — (re)send the pay link
 *   POST /api/admin/invoices/:id/payments     — record a cash/check payment
 *   POST /api/admin/invoices/:id/void         — void it
 *
 * Customer routes (tokenized link, no login):
 *   GET  /invoice/:token                      — the invoice and what's still owed
 *   POST /invoice/:token/checkout             — pay all or PART of it by card
 *
 * ── Where the numbers come from ──────────────────────────────────────────
 * The Google Sheets master list (clientSheet.ts) already holds who signed up, on
 * which plan, for which suite. So an invoice is never typed from scratch: staff
 * pick a client from the list and the plan's price (shared/billing.ts) becomes
 * the first line item. What was invoiced, and what's still owed, is written back
 * to that same row — the sheet stays the one place the team looks.
 *
 * ── Partial payments ─────────────────────────────────────────────────────
 * An invoice is not a single Stripe charge. It's a balance, and a customer may
 * pay it down in instalments, each a separate Checkout session credited against
 * the invoice. That's why the ledger lives here and not in Stripe Invoicing:
 * a Stripe invoice is paid once, in full.
 *
 * ── The 3% card fee ──────────────────────────────────────────────────────
 * Card payments carry a surcharge (CARD_FEE_PERCENT, default 3) as its own
 * Stripe line item. It is charged ON TOP of the payment and is NOT credited
 * against the balance — pay $199 by card and you're charged $204.97 and owe
 * nothing; pay the same $199 in cash at the office and there's no fee at all.
 * Staff-recorded (offline) payments therefore never attract one.
 *
 * ── Trust ────────────────────────────────────────────────────────────────
 * The browser never sends a price. The customer's page sends only how much of
 * their own balance they want to pay; the server re-reads the invoice, clamps
 * the amount to the outstanding balance, and computes the fee itself.
 */

import crypto from "node:crypto";
import express from "express";
import type { Request, Response } from "express";
import type Stripe from "stripe";
import type { Database } from "better-sqlite3";
import { getDb, nowIso } from "./db.js";
import { getStripe } from "./bookingPayments.js";
import {
  readClientList,
  writeBillingColumns,
  clientSheetConfigured,
  type MasterListClient,
} from "./clientSheet.js";
import {
  ADD_ONS,
  DEFAULT_CARD_FEE_PERCENT,
  PLANS,
  cardFeeCents,
  formatMoney,
  planPriceCents,
  subtotalCents,
  type LineItem,
} from "../shared/billing.js";
import { sendInvoiceIssued, sendPaymentReceipt } from "./memberEmail.js";
import { cardFeePercent } from "./cardFee.js";

const CURRENCY = "usd";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Stripe won't take less than $0.50; $1 is a kinder floor to explain. */
const MIN_CHARGE_CENTS = 100;
/** Default smallest instalment we'll accept on a partial payment. */
const DEFAULT_MIN_PAYMENT_CENTS = 2500;
/** How long a Checkout session (and so the payment attempt) stays alive. */
const CHECKOUT_TTL_MINUTES = 60;

/* ── Rows ─────────────────────────────────────────────────────────────── */

export interface InvoiceRow {
  id: number;
  number: string;
  token: string;
  status: "open" | "partial" | "paid" | "void";
  name: string | null;
  email: string | null;
  company: string | null;
  phone: string | null;
  plan: string | null;
  line_items: string;
  subtotal_cents: number;
  allow_partial: number;
  min_payment_cents: number;
  due_date: string | null;
  memo: string | null;
  staff_notes: string | null;
  sheet_row: number | null;
  sent_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentRow {
  id: number;
  invoice_id: number;
  session_id: string | null;
  payment_intent: string | null;
  method: string;
  status: "pending" | "paid" | "expired";
  amount_cents: number;
  fee_cents: number;
  note: string | null;
  created_at: string;
  paid_at: string | null;
}

function lineItemsOf(inv: InvoiceRow): LineItem[] {
  try {
    const parsed = JSON.parse(inv.line_items);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/* ── Balances ─────────────────────────────────────────────────────────── */

export interface InvoiceView {
  id: number;
  number: string;
  status: InvoiceRow["status"];
  statusLabel: string;
  name: string;
  email: string;
  company: string;
  phone: string;
  plan: string;
  items: LineItem[];
  subtotalCents: number;
  paidCents: number;
  balanceCents: number;
  /** Of the balance, how much is tied up in a live checkout attempt. */
  pendingCents: number;
  /** What can be paid right now: balance minus anything pending. */
  payableCents: number;
  allowPartial: boolean;
  minPaymentCents: number;
  dueDate: string;
  memo: string;
  staffNotes: string;
  sheetRow: number;
  sentAt: string;
  paidAt: string;
  createdAt: string;
  payUrl: string;
  payments: {
    id: number;
    method: string;
    status: string;
    amountCents: number;
    feeCents: number;
    note: string;
    at: string;
  }[];
}

const STATUS_LABELS: Record<InvoiceRow["status"], string> = {
  open: "Unpaid",
  partial: "Partially paid",
  paid: "Paid in full",
  void: "Void",
};

/** Everything credited against an invoice so far. Pending attempts don't count. */
function paidCentsFor(db: Database, invoiceId: number): number {
  const row = db
    .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM invoice_payments WHERE invoice_id = ? AND status = 'paid'")
    .get(invoiceId) as { total: number };
  return Number(row?.total || 0);
}

/** The moment before which a pending payment attempt can no longer be paid. */
const staleCutoff = () => new Date(Date.now() - CHECKOUT_TTL_MINUTES * 60_000).toISOString();

/**
 * Money the customer is already at Stripe's checkout page about to pay.
 *
 * It has to be held back from the payable balance, or a member who opens checkout
 * for the full balance, goes Back, and opens it again has TWO live sessions for
 * the same money — pay both (the first URL stays valid for its TTL) and they have
 * overpaid with nothing on screen admitting it.
 */
function pendingCentsFor(db: Database, invoiceId: number): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM invoice_payments
        WHERE invoice_id = ? AND status = 'pending' AND created_at > ?`,
    )
    .get(invoiceId, staleCutoff()) as { total: number };
  return Number(row?.total || 0);
}

/**
 * Retire attempts whose Stripe session has expired. Stripe won't take money for
 * them any more, so holding their amount back from the balance would leave an
 * invoice unpayable for an hour after someone abandoned a checkout page.
 */
function expireStalePayments(db: Database): void {
  db.prepare("UPDATE invoice_payments SET status = 'expired' WHERE status = 'pending' AND created_at <= ?")
    .run(staleCutoff());
}

function paymentsFor(db: Database, invoiceId: number): PaymentRow[] {
  return db
    .prepare("SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY id DESC")
    .all(invoiceId) as PaymentRow[];
}

export function publicBaseUrl(req?: Request): string {
  const configured = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "");
  if (configured) return configured;
  if (req) return `${req.protocol}://${req.get("host")}`;
  return "";
}

function view(db: Database, inv: InvoiceRow, req?: Request): InvoiceView {
  const paid = paidCentsFor(db, inv.id);
  const balance = Math.max(0, inv.subtotal_cents - paid);
  const pending = inv.status === "void" ? 0 : Math.min(balance, pendingCentsFor(db, inv.id));
  return {
    id: inv.id,
    number: inv.number,
    status: inv.status,
    statusLabel: STATUS_LABELS[inv.status] || inv.status,
    name: inv.name || "",
    email: inv.email || "",
    company: inv.company || "",
    phone: inv.phone || "",
    plan: inv.plan || "",
    items: lineItemsOf(inv),
    subtotalCents: inv.subtotal_cents,
    paidCents: paid,
    balanceCents: balance,
    pendingCents: pending,
    payableCents: Math.max(0, balance - pending),
    allowPartial: Boolean(inv.allow_partial),
    minPaymentCents: inv.min_payment_cents || DEFAULT_MIN_PAYMENT_CENTS,
    dueDate: inv.due_date || "",
    memo: inv.memo || "",
    staffNotes: inv.staff_notes || "",
    sheetRow: inv.sheet_row || 0,
    sentAt: inv.sent_at || "",
    paidAt: inv.paid_at || "",
    createdAt: inv.created_at,
    payUrl: `${publicBaseUrl(req)}/invoice/${inv.token}`,
    payments: paymentsFor(db, inv.id).map((p) => ({
      id: p.id,
      method: p.method,
      status: p.status,
      amountCents: p.amount_cents,
      feeCents: p.fee_cents || 0,
      note: p.note || "",
      at: p.paid_at || p.created_at,
    })),
  };
}

/**
 * The smallest payment this invoice will accept right now.
 *
 * The outer clamp to what's payable is the important one: the floor must never
 * exceed it, or a 50¢ remainder becomes permanently unpayable — every amount at
 * or below it rejected as "below the minimum", everything above it as "more than
 * the balance".
 */
function minAcceptableCents(v: InvoiceView): number {
  if (!v.allowPartial) return v.payableCents;
  return Math.min(v.payableCents, Math.max(MIN_CHARGE_CENTS, Math.min(v.minPaymentCents, v.payableCents)));
}

/**
 * Stripe refuses a charge under $0.50, so a remainder smaller than that can't be
 * taken by card at all — the page says to settle it at the office rather than
 * showing a button that always fails.
 */
const STRIPE_MIN_CENTS = 50;
const payableByCard = (v: InvoiceView) => v.payableCents >= STRIPE_MIN_CENTS;

/* ── Reading and writing invoices ─────────────────────────────────────── */

function byId(db: Database, id: number): InvoiceRow | null {
  return (db.prepare("SELECT * FROM invoices WHERE id = ?").get(id) as InvoiceRow) || null;
}

function byToken(db: Database, token: string): InvoiceRow | null {
  return (db.prepare("SELECT * FROM invoices WHERE token = ?").get(token) as InvoiceRow) || null;
}

/** JVO-2026-0007 — sequential within the calendar year, so it reads as a count. */
function nextNumber(db: Database): string {
  const year = new Date().getFullYear();
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM invoices WHERE number LIKE ?")
    .get(`JVO-${year}-%`) as { n: number };
  let seq = Number(row?.n || 0) + 1;
  // A voided-and-renumbered history could collide; walk forward until free.
  for (let attempt = 0; attempt < 1000; attempt++) {
    const candidate = `JVO-${year}-${String(seq).padStart(4, "0")}`;
    const taken = db.prepare("SELECT 1 FROM invoices WHERE number = ?").get(candidate);
    if (!taken) return candidate;
    seq++;
  }
  return `JVO-${year}-${Date.now()}`;
}

/** Recompute status from the ledger and mirror the result onto the master list. */
async function refresh(db: Database, id: number, req?: Request): Promise<InvoiceView | null> {
  const inv = byId(db, id);
  if (!inv) return null;

  const paid = paidCentsFor(db, inv.id);

  /*
   * A void invoice normally stays void. The exception is money actually arriving
   * against one — a member already at Stripe's page when staff voided it, say.
   * Pretending that didn't happen would leave the sheet reading "Void · $0.00"
   * over a real charge, so the invoice reopens and says what it is.
   */
  if (inv.status === "void" && paid > 0) {
    console.error(
      `invoice ${inv.number}: ${formatMoney(paid)} has been paid against a VOIDED invoice — ` +
        `reopening it. Refund in Stripe if this money shouldn't have been taken.`,
    );
  }

  if (inv.status !== "void" || paid > 0) {
    const status: InvoiceRow["status"] = paid >= inv.subtotal_cents ? "paid" : paid > 0 ? "partial" : "open";
    const paidAt = status === "paid" ? inv.paid_at || nowIso() : null;
    if (status !== inv.status || paidAt !== inv.paid_at) {
      db.prepare("UPDATE invoices SET status = ?, paid_at = ?, updated_at = ? WHERE id = ?")
        .run(status, paidAt, nowIso(), inv.id);
    }
  }

  const fresh = byId(db, id)!;
  const v = view(db, fresh, req);
  void syncSheet(v); // fire and forget: the sheet is a mirror, never the source
  return v;
}

/**
 * Mirror a master-list row's billing state onto the sheet.
 *
 * Written from ALL of that row's invoices, not just the one that changed: monthly
 * membership billing means a client accumulates invoices, and a late payment on
 * September's must not overwrite the row with September's numbers while October's
 * is still outstanding. So the row shows the newest invoice, and a Balance Due
 * that is everything the client owes across every invoice on it.
 *
 * Failures are logged, never thrown — the sheet is a mirror, not the source.
 */
async function syncSheet(v: InvoiceView): Promise<void> {
  if (!v.sheetRow || !clientSheetConfigured()) return;
  const db = getDb();
  if (!db) return;

  try {
    const rows = db
      .prepare("SELECT * FROM invoices WHERE sheet_row = ? ORDER BY id DESC")
      .all(v.sheetRow) as InvoiceRow[];
    const live = rows.filter((r) => r.status !== "void");
    const newest = live[0];

    // Every invoice on this row was voided (or this one is, and it's the only one).
    if (!newest) {
      await writeBillingColumns(v.sheetRow, {
        invoiceNumber: v.number,
        invoiceTotal: formatMoney(v.subtotalCents),
        invoiceStatus: "Void",
        balanceDue: formatMoney(0),
      });
      return;
    }

    const newestView = view(db, newest);
    const owed = live.reduce((sum, r) => sum + Math.max(0, r.subtotal_cents - paidCentsFor(db, r.id)), 0);
    const othersOpen = live.filter((r) => r.id !== newest.id && r.subtotal_cents > paidCentsFor(db, r.id)).length;

    await writeBillingColumns(v.sheetRow, {
      invoiceNumber: newestView.number,
      invoiceTotal: formatMoney(newestView.subtotalCents),
      invoiceStatus: othersOpen
        ? `${newestView.statusLabel} · +${othersOpen} more unpaid`
        : newestView.statusLabel,
      balanceDue: formatMoney(owed),
    });
  } catch (e: any) {
    console.error(`invoices: could not mirror ${v.number} to the master list —`, e?.message);
  }
}

/* ── Line-item validation ─────────────────────────────────────────────── */

function parseItems(raw: unknown): { items: LineItem[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: "Add at least one line item." };
  if (raw.length > 25) return { error: "That's more than 25 line items." };
  const items: LineItem[] = [];
  for (const r of raw) {
    const description = String((r as any)?.description || "").trim().slice(0, 200);
    const quantity = Number((r as any)?.quantity);
    const unitCents = Math.round(Number((r as any)?.unitCents));
    if (!description) return { error: "Every line item needs a description." };
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 999) {
      return { error: `Quantity for "${description}" must be a whole number between 1 and 999.` };
    }
    if (!Number.isFinite(unitCents) || unitCents < 0 || unitCents > 99_999_900) {
      return { error: `Amount for "${description}" isn't a valid price.` };
    }
    items.push({ description, quantity, unitCents });
  }
  const total = subtotalCents(items);
  if (total < MIN_CHARGE_CENTS) return { error: "An invoice has to come to at least $1.00." };
  if (total > 99_999_900) return { error: "That invoice total is implausibly large." };
  return { items };
}

/* ── Crediting a Stripe payment ───────────────────────────────────────── */

/**
 * Credit a paid Checkout session against its invoice. Idempotent: the payment row
 * is keyed by session id and only moves pending → paid once, so Stripe's webhook
 * retries and the return-page reconciliation can both run without double-crediting.
 */
export async function creditInvoiceCheckoutSession(session: Stripe.Checkout.Session): Promise<void> {
  const db = getDb();
  if (!db) {
    console.error("invoices: no database — cannot credit session", session.id);
    return;
  }
  const payment = db
    .prepare("SELECT * FROM invoice_payments WHERE session_id = ?")
    .get(session.id) as PaymentRow | undefined;
  if (!payment) {
    console.warn(`invoices: paid session ${session.id} matches no payment row`);
    return;
  }
  if (payment.status === "paid") return; // already credited

  /*
   * "status != 'paid'" is the idempotency guard — safe if a second process ever
   * runs this line for the same session at the same moment.
   *
   * It deliberately does NOT insist on 'pending'. An attempt we marked expired
   * (our TTL sweep, or a void) can still be one Stripe took money for, and the
   * money arriving is the fact that settles it: refusing to credit an 'expired'
   * row would lose a real payment to a timing difference of seconds.
   */
  const credited = db
    .prepare(
      `UPDATE invoice_payments
          SET status = 'paid', paid_at = ?, payment_intent = COALESCE(?, payment_intent)
        WHERE id = ? AND status != 'paid'`,
    )
    .run(nowIso(), String(session.payment_intent || "") || null, payment.id);
  if (credited.changes === 0) return; // someone else got there first
  if (payment.status === "expired") {
    console.warn(`invoices: session ${session.id} paid after we had expired it — credited anyway`);
  }

  const v = await refresh(db, payment.invoice_id);
  if (!v) return;
  console.log(
    `invoice ${v.number}: card payment of ${formatMoney(payment.amount_cents)} ` +
      `(+${formatMoney(payment.fee_cents || 0)} fee) — balance ${formatMoney(v.balanceCents)}`,
  );

  if (v.email) {
    sendPaymentReceipt({
      to: v.email,
      name: v.name,
      invoiceNumber: v.number,
      amountCents: payment.amount_cents,
      feeCents: payment.fee_cents || 0,
      balanceCents: v.balanceCents,
      payUrl: v.payUrl,
    }).catch((e) => console.error("invoices: receipt email failed —", e?.message));
  }
}

/** A session that expired or failed: the attempt is dead, the balance untouched. */
export async function expireInvoiceCheckoutSession(session: Stripe.Checkout.Session): Promise<void> {
  const db = getDb();
  if (!db) return;
  db.prepare("UPDATE invoice_payments SET status = 'expired' WHERE session_id = ? AND status = 'pending'")
    .run(session.id);
}

/**
 * Ask Stripe directly whether a session is paid and credit it if so. The return
 * page calls this so a webhook that is merely slow — or misconfigured entirely —
 * never leaves a customer charged with their balance untouched.
 */
type ReconcileResult = "credited" | "processing" | "expired" | "unknown";

/**
 * They pressed Back on Stripe's page. Release the amount their attempt was holding
 * immediately, instead of making them wait out the hour-long TTL to try again with
 * a different card.
 *
 * Still checks with Stripe first: "cancelled" is only what the redirect claims, and
 * crediting a payment that actually went through matters far more than tidying up.
 */
async function abandonSession(sessionId: string): Promise<ReconcileResult> {
  const stripe = getStripe();
  if (!stripe || !sessionId) return "unknown";
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status === "paid") {
      await creditInvoiceCheckoutSession(session);
      return "credited";
    }
    if (session.status === "open") {
      try {
        await stripe.checkout.sessions.expire(sessionId);
      } catch (e: any) {
        console.warn(`invoices: could not expire abandoned session ${sessionId} —`, e?.message);
      }
    }
    await expireInvoiceCheckoutSession(session);
    return "expired";
  } catch (e: any) {
    console.error("invoices: could not release abandoned session", sessionId, "—", e?.message);
    return "unknown";
  }
}

async function reconcileSession(sessionId: string): Promise<ReconcileResult> {
  const stripe = getStripe();
  if (!stripe || !sessionId) return "unknown";
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status === "paid") {
      await creditInvoiceCheckoutSession(session);
      return "credited";
    }
    if (session.status === "expired") {
      await expireInvoiceCheckoutSession(session);
      return "expired";
    }
    // Delayed methods (ACH and friends) sit here: authorised, not yet settled.
    return "processing";
  } catch (e: any) {
    console.error("invoices: could not reconcile session", sessionId, "—", e?.message);
    return "unknown";
  }
}

/* ── Routes ───────────────────────────────────────────────────────────── */

export function invoicesRouter(requireAdmin: express.RequestHandler): express.Router {
  const router = express.Router();
  router.use(["/admin/invoices", "/api/admin/invoicing", "/api/admin/invoices"], requireAdmin);
  router.use(["/api/admin/invoicing", "/api/admin/invoices"], express.json());

  const db503 = (res: Response): Database | null => {
    const db = getDb();
    if (!db) {
      res.status(503).json({ error: "The invoice ledger needs the database, which isn't available." });
      return null;
    }
    return db;
  };

  /* ── Staff: the master list, ready to invoice from ─────────────────── */
  router.get("/api/admin/invoicing/clients", async (req, res) => {
    const db = getDb();
    let clients: MasterListClient[] = [];
    let error = "";
    try {
      clients = await readClientList();
    } catch (e: any) {
      error = e?.message || "Could not read the client master list.";
    }

    // Pair each client with any invoice already raised for their row, so staff
    // can see at a glance who still needs one.
    const invoices = db
      ? (db.prepare("SELECT * FROM invoices ORDER BY id DESC").all() as InvoiceRow[])
      : [];
    const byRow = new Map<number, InvoiceRow[]>();
    const byEmail = new Map<string, InvoiceRow[]>();
    for (const inv of invoices) {
      if (inv.status === "void") continue;
      if (inv.sheet_row) byRow.set(inv.sheet_row, [...(byRow.get(inv.sheet_row) || []), inv]);
      const key = (inv.email || "").toLowerCase();
      if (key) byEmail.set(key, [...(byEmail.get(key) || []), inv]);
    }

    res.json({
      ok: true,
      error: error || undefined,
      sheetConfigured: clientSheetConfigured(),
      cardFeePercent: cardFeePercent(),
      plans: PLANS,
      addOns: ADD_ONS,
      clients: clients.map((c) => {
        const matches = byRow.get(c.row) || byEmail.get((c.email || "").toLowerCase()) || [];
        const suggested = planPriceCents(c.plan);
        return {
          ...c,
          suggestedCents: suggested,
          suggestedLabel: suggested ? formatMoney(suggested) : "",
          invoices: matches.map((inv) => ({
            id: inv.id,
            number: inv.number,
            status: inv.status,
            statusLabel: STATUS_LABELS[inv.status],
            subtotalCents: inv.subtotal_cents,
            balanceCents: db ? Math.max(0, inv.subtotal_cents - paidCentsFor(db, inv.id)) : inv.subtotal_cents,
          })),
        };
      }),
    });
  });

  /* ── Staff: invoice list ───────────────────────────────────────────── */
  router.get("/api/admin/invoices", (req, res) => {
    const db = db503(res);
    if (!db) return;
    expireStalePayments(db);
    const rows = db.prepare("SELECT * FROM invoices ORDER BY id DESC LIMIT 500").all() as InvoiceRow[];
    const invoices = rows.map((r) => view(db, r, req));
    res.json({
      ok: true,
      cardFeePercent: cardFeePercent(),
      stripeReady: Boolean(getStripe()),
      outstandingCents: invoices
        .filter((i) => i.status === "open" || i.status === "partial")
        .reduce((sum, i) => sum + i.balanceCents, 0),
      invoices,
    });
  });

  router.get("/api/admin/invoices/:id", (req, res) => {
    const db = db503(res);
    if (!db) return;
    expireStalePayments(db);
    const inv = byId(db, Number(req.params.id));
    if (!inv) return res.status(404).json({ error: "No such invoice." });
    res.json({ ok: true, invoice: view(db, inv, req) });
  });

  /* ── Staff: write one up ───────────────────────────────────────────── */
  router.post("/api/admin/invoices", async (req, res) => {
    const db = db503(res);
    if (!db) return;

    const body = req.body || {};
    const name = String(body.name || "").trim().slice(0, 200);
    const email = String(body.email || "").trim().toLowerCase().slice(0, 320);
    if (!name) return res.status(400).json({ error: "A client name is required." });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "A valid client email is required." });

    const parsed = parseItems(body.items);
    if ("error" in parsed) return res.status(400).json({ error: parsed.error });
    const { items } = parsed;

    const dueDate = String(body.dueDate || "").trim();
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      return res.status(400).json({ error: "Due date must be YYYY-MM-DD." });
    }

    const subtotal = subtotalCents(items);
    // Explicit opt-out only — but a stringy "false" has to count as one too.
    const allowPartial = body.allowPartial === false || body.allowPartial === "false" ? 0 : 1;
    const rawMin = Math.round(Number(body.minPaymentCents));
    const minPayment = Number.isFinite(rawMin) && rawMin > 0
      ? Math.min(Math.max(rawMin, MIN_CHARGE_CENTS), subtotal)
      : Math.min(DEFAULT_MIN_PAYMENT_CENTS, subtotal);

    const number = nextNumber(db);
    const token = crypto.randomBytes(24).toString("base64url");
    const info = db
      .prepare(
        `INSERT INTO invoices (
           number, token, status, name, email, company, phone, plan, line_items,
           subtotal_cents, allow_partial, min_payment_cents, due_date, memo,
           staff_notes, sheet_row, created_at, updated_at
         ) VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        number,
        token,
        name,
        email,
        String(body.company || "").trim().slice(0, 200) || null,
        String(body.phone || "").trim().slice(0, 50) || null,
        String(body.plan || "").trim().slice(0, 120) || null,
        JSON.stringify(items),
        subtotal,
        allowPartial,
        minPayment,
        dueDate || null,
        String(body.memo || "").trim().slice(0, 1000) || null,
        String(body.staffNotes || "").trim().slice(0, 1000) || null,
        Number(body.sheetRow) > 1 ? Math.round(Number(body.sheetRow)) : null,
        nowIso(),
        nowIso(),
      );

    const v = view(db, byId(db, Number(info.lastInsertRowid))!, req);
    void syncSheet(v);

    // Emailing is the normal case but must never lose the invoice: a failed send
    // is reported and the pay link is still on screen for staff to copy.
    let mail: { sent: boolean; dryRun?: boolean; configured: boolean } | null = null;
    if (body.send !== false) {
      try {
        mail = await sendInvoiceIssued({
          to: v.email,
          name: v.name,
          invoiceNumber: v.number,
          items: v.items,
          subtotalCents: v.subtotalCents,
          balanceCents: v.balanceCents,
          dueDate: v.dueDate,
          memo: v.memo,
          payUrl: v.payUrl,
          allowPartial: v.allowPartial,
          minPaymentCents: minAcceptableCents(v),
          cardFeePercent: cardFeePercent(),
        });
        if (mail.sent) {
          db.prepare("UPDATE invoices SET sent_at = ?, updated_at = ? WHERE id = ?")
            .run(nowIso(), nowIso(), v.id);
        }
      } catch (e: any) {
        console.error("invoices: issue email failed —", e?.message);
        mail = { sent: false, configured: true };
      }
    }

    console.log(`invoice ${v.number} raised for ${v.email} — ${formatMoney(v.subtotalCents)}`);
    res.json({ ok: true, invoice: view(db, byId(db, v.id)!, req), mail });
  });

  /* ── Staff: (re)send the pay link ──────────────────────────────────── */
  router.post("/api/admin/invoices/:id/send", async (req, res) => {
    const db = db503(res);
    if (!db) return;
    const inv = byId(db, Number(req.params.id));
    if (!inv) return res.status(404).json({ error: "No such invoice." });
    const v = view(db, inv, req);
    if (v.status === "void") return res.status(400).json({ error: "That invoice is void." });
    if (!v.email) return res.status(400).json({ error: "That invoice has no email address on it." });

    try {
      const mail = await sendInvoiceIssued({
        to: v.email,
        name: v.name,
        invoiceNumber: v.number,
        items: v.items,
        subtotalCents: v.subtotalCents,
        balanceCents: v.balanceCents,
        dueDate: v.dueDate,
        memo: v.memo,
        payUrl: v.payUrl,
        allowPartial: v.allowPartial,
        minPaymentCents: minAcceptableCents(v),
        cardFeePercent: cardFeePercent(),
      });
      if (mail.sent) {
        db.prepare("UPDATE invoices SET sent_at = ?, updated_at = ? WHERE id = ?")
          .run(nowIso(), nowIso(), v.id);
      }
      res.json({ ok: true, mail, invoice: view(db, byId(db, v.id)!, req) });
    } catch (e: any) {
      res.status(502).json({ error: `Could not send the invoice: ${e?.message}` });
    }
  });

  /* ── Staff: record a cash / check payment ──────────────────────────── */
  /*
   * No surcharge here, ever. The 3% exists to cover card processing, so a
   * payment that didn't go through a card doesn't carry it.
   */
  router.post("/api/admin/invoices/:id/payments", async (req, res) => {
    const db = db503(res);
    if (!db) return;
    const inv = byId(db, Number(req.params.id));
    if (!inv) return res.status(404).json({ error: "No such invoice." });
    const v = view(db, inv, req);
    if (v.status === "void") return res.status(400).json({ error: "That invoice is void." });
    if (v.balanceCents <= 0) return res.status(400).json({ error: "That invoice is already paid in full." });

    const amount = Math.round(Number(req.body?.amountCents));
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "Enter the amount received." });
    }
    if (amount > v.balanceCents) {
      return res.status(400).json({
        error: `That's more than the ${formatMoney(v.balanceCents)} outstanding. Record ${formatMoney(v.balanceCents)} to clear it.`,
      });
    }
    const method = ["cash", "check", "ach", "other"].includes(String(req.body?.method))
      ? String(req.body.method)
      : "cash";

    db.prepare(
      `INSERT INTO invoice_payments (invoice_id, method, status, amount_cents, fee_cents, note, created_at, paid_at)
       VALUES (?, ?, 'paid', ?, 0, ?, ?, ?)`,
    ).run(v.id, method, amount, String(req.body?.note || "").trim().slice(0, 300) || null, nowIso(), nowIso());

    const fresh = await refresh(db, v.id, req);
    console.log(`invoice ${v.number}: ${method} payment of ${formatMoney(amount)} recorded by staff`);
    res.json({ ok: true, invoice: fresh });
  });

  /* ── Staff: void ──────────────────────────────────────────────────── */
  router.post("/api/admin/invoices/:id/void", async (req, res) => {
    const db = db503(res);
    if (!db) return;
    const inv = byId(db, Number(req.params.id));
    if (!inv) return res.status(404).json({ error: "No such invoice." });
    if (paidCentsFor(db, inv.id) > 0) {
      return res.status(400).json({
        error: "Money has already been taken against this invoice — refund it in Stripe rather than voiding.",
      });
    }

    /*
     * Kill any checkout session still open on it. Without this, a member sitting on
     * Stripe's payment page can pay an invoice that was cancelled a minute earlier.
     * (If they complete it anyway — the race is real but narrow — refresh() reopens
     * the invoice and shouts, rather than pocketing the money silently.)
     */
    const live = db
      .prepare("SELECT session_id FROM invoice_payments WHERE invoice_id = ? AND status = 'pending'")
      .all(inv.id) as { session_id: string | null }[];
    db.prepare("UPDATE invoice_payments SET status = 'expired' WHERE invoice_id = ? AND status = 'pending'")
      .run(inv.id);
    const stripe = getStripe();
    if (stripe) {
      for (const p of live) {
        if (!p.session_id) continue;
        try {
          await stripe.checkout.sessions.expire(p.session_id);
        } catch (e: any) {
          // Already paid, already expired, or Stripe is unreachable — all survivable.
          console.warn(`invoices: could not expire session ${p.session_id} —`, e?.message);
        }
      }
    }

    db.prepare("UPDATE invoices SET status = 'void', updated_at = ? WHERE id = ?").run(nowIso(), inv.id);
    const v = view(db, byId(db, inv.id)!, req);
    void syncSheet(v);
    res.json({ ok: true, invoice: v });
  });

  /* ── Staff: the invoicing screen ───────────────────────────────────── */
  router.get("/admin/invoices", (_req, res) => {
    res.type("html").send(INVOICING_PAGE);
  });

  /* ── Customer: the invoice ─────────────────────────────────────────── */
  router.get("/invoice/:token", async (req, res) => {
    if (rateLimited(req)) {
      return res.status(429).type("html").send(payPage(null, { message: "Too many requests — please wait a minute and try again." }));
    }
    const db = getDb();
    if (!db) {
      return res.status(503).type("html").send(payPage(null, { message: "Invoices are briefly unavailable. Please call us on (678) 519-4723." }));
    }

    // Came back from Stripe? Settle it before drawing the page, so the balance
    // they see is the balance after their payment. The RESULT decides what the
    // banner says — announcing "your payment is in" off the mere presence of a
    // session_id would congratulate someone whose ACH debit hasn't cleared.
    const sessionId = String(req.query.session_id || "");
    const canceled = String(req.query.canceled || "") === "1";
    const outcome: ReconcileResult | null = !sessionId
      ? null
      : canceled
        ? await abandonSession(sessionId) // they backed out — free the hold now
        : await reconcileSession(sessionId);
    expireStalePayments(db);

    const inv = byToken(db, String(req.params.token));
    if (!inv) return res.status(404).type("html").send(payPage(null, { message: "We couldn't find that invoice. Please check the link in your email, or call us on (678) 519-4723." }));

    const v = view(db, inv, req);
    res.type("html").send(
      payPage(v, {
        // A cancel that turned out to be paid is a payment, not a cancellation.
        outcome: canceled && outcome !== "credited" ? null : outcome,
        canceled: canceled && outcome !== "credited",
        cardFeePercent: cardFeePercent(),
        minCents: minAcceptableCents(v),
        stripeReady: Boolean(getStripe()),
      }),
    );
  });

  /* ── Customer: pay all or part of it ──────────────────────────────── */
  router.post("/invoice/:token/checkout", express.json(), async (req, res) => {
    if (rateLimited(req)) return res.status(429).json({ error: "Too many requests — please wait a minute." });

    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({ error: "Card payment isn't set up yet. Please call us on (678) 519-4723." });
    }
    const db = getDb();
    if (!db) return res.status(503).json({ error: "Payments are briefly unavailable. Please try again shortly." });

    expireStalePayments(db);
    const inv = byToken(db, String(req.params.token));
    if (!inv) return res.status(404).json({ error: "We couldn't find that invoice." });
    const v = view(db, inv, req);
    if (v.status === "void") return res.status(400).json({ error: "That invoice has been voided — nothing is owed." });
    if (v.balanceCents <= 0) return res.status(400).json({ error: "That invoice is already paid in full." });
    if (v.payableCents <= 0) {
      return res.status(409).json({
        error:
          "A payment for this invoice is still going through. Give it a few minutes and reload this page — " +
          "we don't want to charge you twice.",
      });
    }
    if (!payableByCard(v)) {
      return res.status(400).json({
        error: `A remainder of ${formatMoney(v.payableCents)} is too small to charge to a card. Please settle it at the office or call us.`,
      });
    }

    // The browser asks for an amount; the server decides whether it's allowed.
    const requested = Math.round(Number(req.body?.amountCents));
    const min = minAcceptableCents(v);
    if (!Number.isFinite(requested) || requested <= 0) {
      return res.status(400).json({ error: "Enter how much you'd like to pay." });
    }
    // Against what's PAYABLE, not the raw balance: money already sitting in a live
    // checkout session is spoken for.
    if (requested > v.payableCents) {
      return res.status(400).json({
        error:
          v.pendingCents > 0
            ? `Of the ${formatMoney(v.balanceCents)} outstanding, ${formatMoney(v.pendingCents)} is already in a payment that's going through — you can pay up to ${formatMoney(v.payableCents)} now.`
            : `That's more than the ${formatMoney(v.balanceCents)} outstanding.`,
      });
    }
    if (requested < min) {
      return res.status(400).json({
        error: v.allowPartial
          ? `The smallest payment we can take on this invoice is ${formatMoney(min)}.`
          : `This invoice is payable in full — ${formatMoney(v.balanceCents)}.`,
      });
    }

    const fee = cardFeeCents(requested, cardFeePercent());
    const origin = publicBaseUrl(req);
    const isPartial = requested < v.balanceCents;

    try {
      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
        {
          quantity: 1,
          price_data: {
            currency: CURRENCY,
            unit_amount: requested,
            product_data: {
              name: `Invoice ${v.number}${isPartial ? " — partial payment" : ""}`,
              description: isPartial
                ? `${formatMoney(requested)} toward a balance of ${formatMoney(v.balanceCents)}`
                : `Balance in full${v.plan ? ` · ${v.plan}` : ""}`,
            },
          },
        },
      ];
      if (fee > 0) {
        lineItems.push({
          quantity: 1,
          price_data: {
            currency: CURRENCY,
            unit_amount: fee,
            product_data: {
              name: `Card processing fee (${cardFeePercent()}%)`,
              description: "Waived when paying by cash or check at the office.",
            },
          },
        });
      }

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: v.email || undefined,
        expires_at: Math.floor((Date.now() + CHECKOUT_TTL_MINUTES * 60_000) / 1000),
        line_items: lineItems,
        metadata: {
          kind: "invoice_payment",
          invoiceId: String(v.id),
          invoiceNumber: v.number,
          amountCents: String(requested),
          feeCents: String(fee),
        },
        success_url: `${origin}/invoice/${inv.token}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/invoice/${inv.token}?canceled=1&session_id={CHECKOUT_SESSION_ID}`,
      });

      // Written BEFORE they reach Stripe: the webhook can only credit a payment
      // it can find, and it may arrive before the browser comes back.
      db.prepare(
        `INSERT INTO invoice_payments (invoice_id, session_id, method, status, amount_cents, fee_cents, created_at)
         VALUES (?, ?, 'card', 'pending', ?, ?, ?)`,
      ).run(v.id, session.id, requested, fee, nowIso());

      res.json({ url: session.url, amountCents: requested, feeCents: fee, totalCents: requested + fee });
    } catch (e: any) {
      console.error("invoices: checkout create failed —", e?.message);
      res.status(502).json({ error: "Could not start the payment. Please try again or call us." });
    }
  });

  return router;
}

/* ── Rate limit for the public pay link (token guessing) ─────────────── */

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, { count: number; windowStart: number }>();

/*
 * The caller's address as seen through Render's proxy. req.ip would be the
 * PROXY's address for every visitor in production, making the limit below global
 * rather than per-customer — 30 page loads on a billing day and the next member
 * to open their invoice gets a 429. Same approach as the booking throttle.
 */
function clientIp(req: Request): string {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "?")
    .split(",")[0]
    .trim();
}

function rateLimited(req: Request): boolean {
  const ip = clientIp(req);
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now - rec.windowStart > RATE_WINDOW_MS) {
    hits.set(ip, { count: 1, windowStart: now });
    return false;
  }
  rec.count++;
  return rec.count > RATE_LIMIT;
}

setInterval(() => {
  const now = Date.now();
  hits.forEach((rec, ip) => {
    if (now - rec.windowStart > RATE_WINDOW_MS) hits.delete(ip);
  });
}, 5 * 60_000).unref();

/* ── The customer's page ──────────────────────────────────────────────── */

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const PAY_PAGE_CSS = `
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:#FAFAFA; color:#0A0A0A; font-family:'DM Sans',Arial,sans-serif; min-height:100vh;
         display:flex; flex-direction:column; align-items:center; padding:44px 16px; }
  .wrap { width:100%; max-width:640px; }
  .brand .word { font-size:11px; font-weight:600; letter-spacing:3px; text-transform:uppercase; }
  .brand .sub { font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#6B7280; margin-top:4px; }
  h1 { font-family:'Cormorant Garamond',Georgia,serif; font-weight:600; font-size:34px; line-height:1.15; margin:28px 0 6px; }
  h1 em { font-style:italic; }
  .lede { color:#1C1C1E; font-size:15px; line-height:1.65; margin-bottom:24px; max-width:56ch; }
  .panel { background:#FFF; border:1px solid #E5E5E5; border-radius:4px; padding:24px 26px; margin-bottom:14px; }
  .pill { display:inline-block; border:1px solid #0A0A0A; border-radius:3px; padding:3px 10px; font-size:10px;
          letter-spacing:2px; text-transform:uppercase; }
  .pill.paid { border-color:#1B7F4B; color:#1B7F4B; }
  .pill.partial { border-color:#9A6B00; color:#9A6B00; }
  .pill.void { border-color:#6B7280; color:#6B7280; }
  table { width:100%; border-collapse:collapse; margin:16px 0 4px; font-size:14px; }
  th { text-align:left; font-size:10px; letter-spacing:2px; text-transform:uppercase; color:#6B7280;
       border-bottom:1px solid #E5E5E5; padding:0 0 8px; font-weight:600; }
  td { padding:10px 0; border-bottom:1px solid #F0F0F0; vertical-align:top; }
  td.num, th.num { text-align:right; white-space:nowrap; }
  .totals { margin-top:14px; font-size:14px; }
  .totals div { display:flex; justify-content:space-between; padding:5px 0; }
  .totals .big { font-size:17px; font-weight:600; border-top:1px solid #E5E5E5; margin-top:6px; padding-top:12px; }
  label { display:block; font-size:10px; font-weight:600; letter-spacing:2px; text-transform:uppercase;
          color:#6B7280; margin:16px 0 6px; }
  input[type=text] { width:100%; background:#FFF; border:1px solid #D6D6D6; border-radius:4px; padding:12px;
                     font-family:inherit; font-size:17px; }
  input:focus { outline:none; border-color:#0A0A0A; }
  .quick { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
  .quick button { background:transparent; color:#0A0A0A; border:1px solid #C9C9C9; font-weight:500; }
  button { font-family:inherit; font-size:12px; font-weight:600; letter-spacing:1.5px; text-transform:uppercase;
           padding:13px 24px; cursor:pointer; background:#0A0A0A; color:#FFF; border:1px solid #0A0A0A;
           border-radius:4px; margin-top:18px; }
  button:hover { background:#1C1C1E; }
  button:disabled { opacity:.4; cursor:not-allowed; }
  .breakdown { font-size:14px; color:#1C1C1E; background:#F5F5F5; border-radius:4px; padding:12px 14px; margin-top:16px; line-height:1.7; }
  .breakdown span { float:right; }
  .note { font-size:13px; color:#6B7280; line-height:1.6; margin-top:12px; }
  .err { color:#B42318; font-size:13px; margin-top:12px; display:none; }
  .good { border-left:2px solid #1B7F4B; background:#F1F7F3; border-radius:4px; padding:14px 16px; font-size:14px;
          line-height:1.6; margin-bottom:14px; }
  .warn { border-left:2px solid #9A6B00; background:#FBF7EF; border-radius:4px; padding:14px 16px; font-size:14px;
          line-height:1.6; margin-bottom:14px; }
  .hist { font-size:13px; color:#1C1C1E; }
  .hist div { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #F0F0F0; }
  .sec { font-size:10px; font-weight:600; letter-spacing:2px; text-transform:uppercase; color:#6B7280; margin:20px 0 4px; }
  .foot { color:#6B7280; font-size:12px; margin-top:26px; line-height:1.7; }
  a { color:#0A0A0A; }
`;

function payShell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)} — Jonesboro Virtual Office</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;1,600&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>${PAY_PAGE_CSS}</style>
</head>
<body>
<div class="wrap">
  <div class="brand">
    <div class="word">Jonesboro Virtual Office</div>
    <div class="sub">127 Jonesboro Rd, Suite 100 · Jonesboro, GA 30236</div>
  </div>
  ${body}
  <div class="foot">
    Questions about this invoice? Call (678) 519-4723 or email jonesborovirtualoffice@gmail.com.<br>
    Paying by cash or check at the office carries no processing fee.
  </div>
</div>
</body>
</html>`;
}

interface PayPageOpts {
  message?: string;
  /** What came of settling the session they returned with, if they returned with one. */
  outcome?: ReconcileResult | null;
  canceled?: boolean;
  cardFeePercent?: number;
  minCents?: number;
  stripeReady?: boolean;
}

/** The invoice as the customer sees it — server-rendered, no SPA, no login. */
function payPage(v: InvoiceView | null, opts: PayPageOpts): string {
  if (!v) {
    return payShell("Invoice", `
      <h1>Invoice <em>unavailable.</em></h1>
      <p class="lede">${esc(opts.message || "We couldn't open that invoice.")}</p>`);
  }

  const rows = v.items
    .map(
      (i) => `<tr>
        <td>${esc(i.description)}</td>
        <td class="num">${i.quantity}</td>
        <td class="num">${esc(formatMoney(i.unitCents))}</td>
        <td class="num">${esc(formatMoney(Math.round(i.quantity * i.unitCents)))}</td>
      </tr>`,
    )
    .join("");

  const history = v.payments
    .filter((p) => p.status === "paid")
    .map(
      (p) => `<div><span>${esc((p.at || "").slice(0, 10))} · ${esc(p.method)}${
        p.feeCents ? ` (incl. ${esc(formatMoney(p.feeCents))} card fee)` : ""
      }</span><span>${esc(formatMoney(p.amountCents))}</span></div>`,
    )
    .join("");

  const settled = v.status === "paid" || v.status === "void" || v.balanceCents <= 0;
  const feePct = opts.cardFeePercent ?? DEFAULT_CARD_FEE_PERCENT;
  const minCents = opts.minCents ?? v.balanceCents;

  /*
   * Only "credited" earns a thank-you. A delayed payment method comes back
   * authorised but unsettled, and telling that customer their payment is in —
   * beside an unchanged balance — is the one message here that must never be wrong.
   */
  const banner =
    opts.outcome === "credited" && settled
      ? `<div class="good"><strong>Thank you — your payment is in.</strong><br>This invoice is settled in full. A receipt is on its way to your email.</div>`
      : opts.outcome === "credited"
        ? `<div class="good"><strong>Thank you — your payment is in.</strong><br>${esc(formatMoney(v.balanceCents))} of this invoice remains outstanding. You can pay the rest whenever suits, from this same link.</div>`
        : opts.outcome === "processing"
          ? `<div class="warn"><strong>Your payment is processing.</strong><br>Some payment methods take a few days to clear. We'll email your receipt the moment it does, and this page will show the new balance — there's nothing more for you to do.</div>`
          : opts.outcome === "expired"
            ? `<div class="warn">That payment session timed out and nothing was charged. You can start it again below.</div>`
            : opts.outcome === "unknown"
              ? `<div class="warn">We couldn't confirm that payment just now. If you were charged it will appear here shortly — please don't pay twice; call us on (678) 519-4723 if anything looks wrong.</div>`
              : opts.canceled
                ? `<div class="warn">Payment cancelled — nothing was charged. The invoice is still here whenever you're ready.</div>`
                : "";

  const payBlock = settled
    ? `<div class="panel"><div class="pill ${v.status}">${esc(v.statusLabel)}</div>
         <p class="note" style="margin-top:12px">${
           v.status === "void"
             ? "This invoice has been cancelled. Nothing is owed."
             : "Nothing further is owed on this invoice. Thank you."
         }</p></div>`
    : !opts.stripeReady
      ? `<div class="panel"><h2 style="font-family:'Cormorant Garamond',Georgia,serif;font-size:21px;font-weight:600">Pay by phone or in <em>person.</em></h2>
           <p class="note">Card payment isn't available online just now. Please call (678) 519-4723 or stop by the office — cash and check are always fee-free.</p></div>`
      : v.payableCents <= 0
        ? `<div class="panel"><h2 style="font-family:'Cormorant Garamond',Georgia,serif;font-size:21px;font-weight:600">A payment is going <em>through.</em></h2>
             <p class="note">${esc(formatMoney(v.pendingCents))} is already in a payment we're waiting on, so there's nothing to pay right now. Reload this page in a few minutes — we'd rather you weren't charged twice.</p></div>`
        : !payableByCard(v)
          ? `<div class="panel"><h2 style="font-family:'Cormorant Garamond',Georgia,serif;font-size:21px;font-weight:600">Settle this at the <em>office.</em></h2>
               <p class="note">${esc(formatMoney(v.payableCents))} is too small for a card payment to go through. Pop in or call (678) 519-4723 and we'll clear it — no fee either way.</p></div>`
          : `<div class="panel">
    <h2 style="font-family:'Cormorant Garamond',Georgia,serif;font-size:21px;font-weight:600">Pay this <em>invoice.</em></h2>
    <p class="note" style="margin-top:6px">${
      v.allowPartial
        ? `Pay it in full, or part of it now and the rest later — the smallest payment we can take is ${esc(formatMoney(minCents))}.`
        : "This invoice is payable in full."
    }</p>
    <label for="amt">Amount to pay (USD)</label>
    <input type="text" id="amt" inputmode="decimal" value="${(v.payableCents / 100).toFixed(2)}" autocomplete="off">
    ${
      v.pendingCents > 0
        ? `<p class="note">${esc(formatMoney(v.pendingCents))} of the ${esc(formatMoney(v.balanceCents))} outstanding is in a payment we're still waiting on, so ${esc(formatMoney(v.payableCents))} is what's payable right now.</p>`
        : ""
    }
    ${
      v.allowPartial
        ? `<div class="quick">
             <button type="button" onclick="setAmt(${v.payableCents})">${v.pendingCents > 0 ? "Everything payable" : "Full balance"}</button>
             ${v.payableCents > minCents * 2 ? `<button type="button" onclick="setAmt(${Math.max(minCents, Math.round(v.payableCents / 2))})">Half</button>` : ""}
             ${v.payableCents > minCents ? `<button type="button" onclick="setAmt(${minCents})">Minimum</button>` : ""}
           </div>`
        : ""
    }
    <div class="breakdown" id="breakdown"></div>
    <button id="pay" onclick="pay()">Pay by card</button>
    <div class="err" id="err"></div>
    <p class="note">${
      feePct > 0
        ? `Card payments carry a ${esc(String(feePct))}% processing fee, shown above before you pay. Cash or check at the office carries none.`
        : "No processing fee applies."
    }</p>
  </div>`;

  const body = `
  <h1>Invoice <em>${esc(v.number)}.</em></h1>
  <p class="lede">${esc(v.name)}${v.company ? ` · ${esc(v.company)}` : ""}${
    v.dueDate ? ` — due ${esc(v.dueDate)}` : ""
  }</p>
  ${banner}
  <div class="panel">
    <div class="pill ${v.status}">${esc(v.statusLabel)}</div>
    <table>
      <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Each</th><th class="num">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <div><span>Invoice total</span><span>${esc(formatMoney(v.subtotalCents))}</span></div>
      ${v.paidCents > 0 ? `<div><span>Paid to date</span><span>− ${esc(formatMoney(v.paidCents))}</span></div>` : ""}
      <div class="big"><span>Balance due</span><span>${esc(formatMoney(v.balanceCents))}</span></div>
    </div>
    ${v.memo ? `<p class="note">${esc(v.memo)}</p>` : ""}
    ${history ? `<div class="sec">Payments received</div><div class="hist">${history}</div>` : ""}
  </div>
  ${payBlock}
  <script>
  var BALANCE = ${v.payableCents};
  var MIN = ${minCents};
  var FEE_PCT = ${feePct};
  function cents(str){
    var cleaned = String(str||"").replace(/[$,\\s]/g,"");
    if(!/^\\d*\\.?\\d*$/.test(cleaned) || cleaned==="" || cleaned===".") return null;
    return Math.round(Number(cleaned)*100);
  }
  function money(c){ return "$" + (c/100).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}); }
  function feeOn(c){ return Math.round(c*FEE_PCT/100); }
  function setAmt(c){ var el=document.getElementById("amt"); if(!el) return; el.value=(c/100).toFixed(2); draw(); }
  function draw(){
    var box = document.getElementById("breakdown");
    if(!box) return;
    var c = cents(document.getElementById("amt").value);
    var btn = document.getElementById("pay");
    if(c===null || c<=0){ box.innerHTML = "Enter an amount to see the total."; btn.disabled = true; return; }
    var problem = c > BALANCE ? "The most you can pay right now is " + money(BALANCE) + "."
                : c < MIN ? "The smallest payment we can take is " + money(MIN) + "." : "";
    if(problem){ box.innerHTML = problem; btn.disabled = true; return; }
    var f = feeOn(c);
    box.innerHTML = "Payment toward invoice <span>" + money(c) + "</span><br>"
      + (f>0 ? "Card processing fee (" + FEE_PCT + "%) <span>" + money(f) + "</span><br>" : "")
      + "<strong>Charged to your card <span>" + money(c+f) + "</span></strong>"
      + (c < BALANCE ? "<br><span style='float:none;color:#6B7280'>Remaining balance afterwards: " + money(BALANCE-c) + "</span>" : "");
    btn.disabled = false;
  }
  async function pay(){
    var err = document.getElementById("err");
    var btn = document.getElementById("pay");
    var c = cents(document.getElementById("amt").value);
    err.style.display="none";
    if(c===null || c<=0){ err.textContent="Enter how much you'd like to pay."; err.style.display="block"; return; }
    btn.disabled = true; btn.textContent = "Opening secure payment…";
    try {
      var r = await fetch(location.pathname.replace(/\\/$/,"") + "/checkout", {
        method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({amountCents:c})
      });
      var j = await r.json().catch(function(){ return {}; });
      if(!r.ok || !j.url) throw new Error(j.error || "Could not start the payment.");
      location.href = j.url;
    } catch(e){
      err.textContent = e.message; err.style.display="block";
      btn.disabled = false; btn.textContent = "Pay by card";
    }
  }
  var amtEl = document.getElementById("amt");
  if(amtEl){ amtEl.addEventListener("input", draw); draw(); }
  </script>`;

  return payShell(`Invoice ${v.number}`, body);
}

/* ── The staff invoicing screen ───────────────────────────────────────── */

const INVOICING_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>JVO — Invoicing</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;1,600&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root { --bg:#FAFAFA; --panel:#FFFFFF; --line:#E5E5E5; --ink:#0A0A0A; --body:#1C1C1E; --muted:#6B7280; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--bg); color:var(--ink); font-family:'DM Sans',Arial,sans-serif; min-height:100vh; }
  header { padding:24px 28px 16px; border-bottom:1px solid var(--line); background:var(--panel);
           display:flex; align-items:baseline; gap:14px; flex-wrap:wrap; }
  header h1 { font-family:'Cormorant Garamond',Georgia,serif; font-weight:600; font-size:26px; }
  header h1 em { font-style:italic; }
  header .sub { color:var(--muted); font-size:11px; letter-spacing:2px; text-transform:uppercase; }
  header a { margin-left:auto; font-size:11px; font-weight:600; letter-spacing:1.5px; text-transform:uppercase; color:var(--ink); }
  main { display:grid; grid-template-columns:1fr 430px; min-height:calc(100vh - 67px); }
  @media (max-width:1100px){ main { grid-template-columns:1fr; } #side { border-left:none; border-top:1px solid var(--line); } }
  #list { padding:22px 28px; }
  #side { border-left:1px solid var(--line); background:var(--panel); padding:22px 24px; }
  h2 { font-family:'Cormorant Garamond',Georgia,serif; font-size:19px; font-weight:600; margin-bottom:4px; }
  h2 em { font-style:italic; }
  .hint { color:var(--muted); font-size:12px; margin-bottom:12px; line-height:1.6; }
  .tabs { display:flex; gap:8px; margin-bottom:16px; }
  .tabs button.on { background:var(--ink); color:#fff; }
  input, select, textarea { background:#fff; color:var(--ink); border:1px solid #D6D6D6; border-radius:4px;
    padding:9px 10px; font-family:'DM Sans',Arial,sans-serif; font-size:13px; }
  input:focus, select:focus, textarea:focus { outline:none; border-color:var(--ink); }
  button { font-family:'DM Sans',Arial,sans-serif; font-size:11px; font-weight:600; letter-spacing:1.5px;
    text-transform:uppercase; padding:10px 16px; cursor:pointer; background:var(--ink); color:#fff;
    border:1px solid var(--ink); border-radius:4px; }
  button:hover { background:#1C1C1E; }
  button.ghost { background:transparent; color:var(--ink); border:1px solid #C9C9C9; font-weight:500; }
  button.ghost:hover { border-color:var(--ink); }
  button.danger { background:transparent; color:#B42318; border:1px solid #E5C5C0; font-weight:500; }
  button.small { padding:6px 10px; font-size:10px; }
  .card { background:var(--panel); border:1px solid var(--line); border-left:2px solid var(--ink); border-radius:4px;
    padding:12px 15px; margin-bottom:8px; display:flex; justify-content:space-between; gap:12px; align-items:center; cursor:pointer; }
  .card:hover { border-color:var(--ink); }
  .card .who { font-weight:600; font-size:14px; }
  .card .meta { color:var(--muted); font-size:12px; margin-top:2px; }
  .card .amt { text-align:right; white-space:nowrap; font-size:14px; }
  .card .amt .bal { color:var(--muted); font-size:12px; }
  .tag { display:inline-block; border:1px solid var(--muted); color:var(--muted); border-radius:3px;
    padding:2px 7px; font-size:9px; letter-spacing:1.5px; text-transform:uppercase; margin-left:6px; }
  .tag.paid { border-color:#1B7F4B; color:#1B7F4B; }
  .tag.partial { border-color:#9A6B00; color:#9A6B00; }
  .tag.open { border-color:var(--ink); color:var(--ink); }
  .tag.void { opacity:.6; }
  .sec { font-size:10px; font-weight:600; letter-spacing:2px; text-transform:uppercase; margin:18px 0 8px;
    border-top:1px solid var(--line); padding-top:14px; }
  .row { display:flex; gap:8px; align-items:center; margin-bottom:8px; flex-wrap:wrap; }
  .row input.desc { flex:1; min-width:140px; }
  .row input.qty { width:60px; }
  .row input.amt { width:110px; }
  label { display:block; font-size:10px; font-weight:600; letter-spacing:2px; text-transform:uppercase;
    color:var(--muted); margin:12px 0 5px; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:0 12px; }
  .total { font-size:15px; font-weight:600; margin:12px 0; }
  .empty { color:var(--muted); padding:26px 0; font-size:14px; line-height:1.6; }
  .warn { border-left:2px solid #9A6B00; background:#FBF7EF; border-radius:4px; padding:12px 14px;
    font-size:13px; line-height:1.6; margin-bottom:14px; }
  dl { display:grid; grid-template-columns:auto 1fr; gap:4px 14px; font-size:13px; margin:10px 0 4px; }
  dt { color:var(--muted); }
  dd { word-break:break-word; color:var(--body); }
  .hist { font-size:12px; color:var(--muted); }
  .hist div { padding:5px 0; border-bottom:1px solid var(--line); }
  .linkrow { display:flex; gap:6px; align-items:center; margin-top:8px; }
  .linkrow input { flex:1; font-size:11px; color:var(--muted); }
  #msg { position:fixed; bottom:18px; right:18px; background:var(--ink); color:#fff; border-radius:4px;
    padding:10px 16px; font-size:13px; display:none; z-index:10; max-width:360px; line-height:1.5; }
  .checkrow { display:flex; gap:8px; align-items:flex-start; font-size:13px; color:var(--body); margin-top:10px; line-height:1.5; }
</style>
</head>
<body>
<header>
  <h1>Invoicing <em>Desk.</em></h1>
  <div class="sub">Written up from the client master list</div>
  <a href="/admin">← Membership pipeline</a>
</header>
<main>
  <section id="list">
    <div class="tabs">
      <button id="tab-clients" class="on" onclick="showTab('clients')">Master list</button>
      <button id="tab-invoices" class="ghost" onclick="showTab('invoices')">Invoices</button>
    </div>
    <div id="pane-clients"><div class="empty">Loading the client master list…</div></div>
    <div id="pane-invoices" style="display:none"><div class="empty">Loading invoices…</div></div>
  </section>
  <aside id="side"><div class="empty">Pick a client on the left to write up their invoice, or an invoice to see its payments.</div></aside>
</main>
<div id="msg"></div>
<script>
var CLIENTS = [], INVOICES = [], PLANS = [], ADDONS = [], FEE_PCT = 3, STRIPE_READY = true, TAB = "clients";

function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
function money(c){ return "$" + ((Number(c)||0)/100).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}); }
function cents(str){
  var cleaned = String(str||"").replace(/[$,\\s]/g,"");
  if(!/^\\d*\\.?\\d*$/.test(cleaned) || cleaned==="" || cleaned===".") return null;
  return Math.round(Number(cleaned)*100);
}
function toast(t){ var m=document.getElementById("msg"); m.textContent=t; m.style.display="block"; clearTimeout(m._t); m._t=setTimeout(function(){m.style.display="none";},5000); }
async function api(url, opts){
  var r = await fetch(url, Object.assign({headers:{"Content-Type":"application/json"}}, opts||{}));
  var j = await r.json().catch(function(){ return {}; });
  if(!r.ok) throw new Error(j.error || ("HTTP " + r.status));
  return j;
}
function mailWord(mail){
  if(!mail) return "not emailed";
  if(mail.sent) return "emailed to the client";
  if(mail.dryRun) return "NOT emailed — MEMBER_EMAILS_ENABLED is false (dry run)";
  if(!mail.configured) return "NOT emailed — SMTP isn't configured";
  return "not emailed";
}

function showTab(which){
  TAB = which;
  document.getElementById("pane-clients").style.display = which==="clients" ? "" : "none";
  document.getElementById("pane-invoices").style.display = which==="invoices" ? "" : "none";
  document.getElementById("tab-clients").className = which==="clients" ? "on" : "ghost";
  document.getElementById("tab-invoices").className = which==="invoices" ? "on" : "ghost";
}

/* ── Master list ──────────────────────────────────────────────── */
async function loadClients(){
  var pane = document.getElementById("pane-clients");
  try {
    var j = await api("/api/admin/invoicing/clients");
    CLIENTS = j.clients || []; PLANS = j.plans || []; ADDONS = j.addOns || []; FEE_PCT = j.cardFeePercent;
    var html = "";
    if(j.error) html += '<div class="warn">' + esc(j.error) + '</div>';
    if(!CLIENTS.length){
      html += '<div class="empty">No clients on the master list yet. Rows appear here as mailbox applications come in.</div>';
    } else {
      html += CLIENTS.map(function(c,i){
        var inv = (c.invoices||[])[0];
        var right = inv
          ? '<div class="amt">' + esc(inv.number) + '<span class="tag ' + esc(inv.status) + '">' + esc(inv.statusLabel) + '</span>'
            + '<div class="bal">' + (inv.balanceCents>0 ? money(inv.balanceCents) + " due" : "settled") + '</div></div>'
          : '<div class="amt">' + (c.suggestedLabel ? esc(c.suggestedLabel) + '<div class="bal">suggested</div>' : '<div class="bal">no plan price</div>') + '</div>';
        return '<div class="card" onclick="pickClient(' + i + ')">'
          + '<div><div class="who">' + esc(c.name || c.company || "(unnamed)") + '</div>'
          + '<div class="meta">' + esc(c.email || "no email") + (c.plan ? " · " + esc(c.plan) : "")
          + (c.suite ? " · Suite " + esc(c.suite) : "") + (c.submitted ? " · " + esc(c.submitted) : "") + '</div></div>'
          + right + '</div>';
      }).join("");
    }
    pane.innerHTML = html;
  } catch(e){
    pane.innerHTML = '<div class="warn">Could not load the master list: ' + esc(e.message) + '</div>';
  }
}

/* ── Invoice list ─────────────────────────────────────────────── */
async function loadInvoices(){
  var pane = document.getElementById("pane-invoices");
  try {
    var j = await api("/api/admin/invoices");
    INVOICES = j.invoices || []; FEE_PCT = j.cardFeePercent; STRIPE_READY = j.stripeReady;
    var html = "";
    if(!STRIPE_READY) html += '<div class="warn">Stripe isn\\'t configured, so clients can\\'t pay online yet. Invoices can still be raised and cash/check payments recorded.</div>';
    html += '<div class="hint">Outstanding across all open invoices: <strong>' + money(j.outstandingCents) + '</strong> · card fee ' + esc(String(FEE_PCT)) + '%</div>';
    if(!INVOICES.length){
      html += '<div class="empty">No invoices yet. Pick a client on the master list to write the first one up.</div>';
    } else {
      html += INVOICES.map(function(v,i){
        return '<div class="card" onclick="pickInvoice(' + i + ')">'
          + '<div><div class="who">' + esc(v.number) + ' — ' + esc(v.name) + '<span class="tag ' + esc(v.status) + '">' + esc(v.statusLabel) + '</span></div>'
          + '<div class="meta">' + esc(v.email) + (v.dueDate ? " · due " + esc(v.dueDate) : "") + (v.sentAt ? "" : " · not sent") + '</div></div>'
          + '<div class="amt">' + money(v.subtotalCents) + '<div class="bal">' + (v.balanceCents>0 ? money(v.balanceCents) + " due" : "settled") + '</div></div>'
          + '</div>';
      }).join("");
    }
    pane.innerHTML = html;
  } catch(e){
    pane.innerHTML = '<div class="warn">Could not load invoices: ' + esc(e.message) + '</div>';
  }
}

/* ── Write-up form ────────────────────────────────────────────── */
function itemRow(desc, qty, amountCents){
  return '<div class="row">'
    + '<input class="desc" type="text" value="' + esc(desc||"") + '" placeholder="Description">'
    + '<input class="qty" type="text" value="' + (qty||1) + '" inputmode="numeric">'
    + '<input class="amt" type="text" value="' + ((Number(amountCents)||0)/100).toFixed(2) + '" inputmode="decimal" placeholder="0.00">'
    + '<button class="ghost small" onclick="this.parentNode.remove(); recalc()">×</button></div>';
}

function pickClient(i){
  var c = CLIENTS[i];
  if(!c) return;
  var planName = c.plan || "";
  var first = planName
    ? (c.suggestedCents ? planName + " — monthly membership" : planName)
    : "Membership";
  var side = document.getElementById("side");
  var addOnOpts = ADDONS.map(function(a){ return '<option value="' + a.cents + '">' + esc(a.name) + (a.cents ? " — " + money(a.cents) : "") + '</option>'; }).join("");
  var planOpts = PLANS.map(function(p){ return '<option value="' + p.cents + '">' + esc(p.name) + ' — ' + money(p.cents) + '</option>'; }).join("");
  side.innerHTML = '<h2>New <em>invoice.</em></h2>'
    + '<div class="hint">From master-list row ' + c.row + '. Amounts come from the price list — change anything that differs.</div>'
    + '<input type="hidden" id="f-row" value="' + c.row + '">'
    + '<div class="grid2"><div><label>Client</label><input type="text" id="f-name" value="' + esc(c.name) + '"></div>'
    + '<div><label>Email</label><input type="email" id="f-email" value="' + esc(c.email) + '"></div></div>'
    + '<div class="grid2"><div><label>Company</label><input type="text" id="f-company" value="' + esc(c.company) + '"></div>'
    + '<div><label>Plan</label><input type="text" id="f-plan" value="' + esc(c.plan) + '"></div></div>'
    + '<div class="sec">Line items</div>'
    + '<div id="f-items">' + itemRow(first, 1, c.suggestedCents || 0) + '</div>'
    + '<div class="row"><select id="f-add"><option value="">Add a line…</option>'
    + '<optgroup label="Memberships">' + planOpts + '</optgroup>'
    + '<optgroup label="Services">' + addOnOpts + '</optgroup></select>'
    + '<button class="ghost small" onclick="addPicked()">Add</button>'
    + '<button class="ghost small" onclick="addBlank()">Blank line</button></div>'
    + '<div class="total" id="f-total">Total: $0.00</div>'
    + '<div class="grid2"><div><label>Due date</label><input type="date" id="f-due"></div>'
    + '<div><label>Minimum payment</label><input type="text" id="f-min" value="25.00" inputmode="decimal"></div></div>'
    + '<div class="checkrow"><input type="checkbox" id="f-partial" checked><label for="f-partial" style="margin:0;text-transform:none;letter-spacing:0;font-size:13px;font-weight:400;color:var(--body)">Let them pay in instalments (partial payments)</label></div>'
    + '<label>Note on the invoice (optional)</label><textarea id="f-memo" rows="2" style="width:100%"></textarea>'
    + '<div class="checkrow"><input type="checkbox" id="f-send" checked><label for="f-send" style="margin:0;text-transform:none;letter-spacing:0;font-size:13px;font-weight:400;color:var(--body)">Email the pay link to the client now</label></div>'
    + '<div class="row" style="margin-top:16px"><button onclick="createInvoice()">Create Invoice</button>'
    + '<button class="ghost" onclick="clearSide()">Cancel</button></div>'
    + '<p class="hint" style="margin-top:10px">Card payments add a ' + esc(String(FEE_PCT)) + '% processing fee on top of the amount paid. Cash and check don\\'t.</p>';
  recalc();
  document.querySelectorAll("#f-items input").forEach(function(el){ el.addEventListener("input", recalc); });
}

function addBlank(){
  document.getElementById("f-items").insertAdjacentHTML("beforeend", itemRow("", 1, 0));
  document.querySelectorAll("#f-items input").forEach(function(el){ el.addEventListener("input", recalc); });
  recalc();
}
function addPicked(){
  var sel = document.getElementById("f-add");
  if(!sel.value && sel.selectedIndex <= 0) return;
  var label = sel.options[sel.selectedIndex].text.split(" — ")[0];
  document.getElementById("f-items").insertAdjacentHTML("beforeend", itemRow(label, 1, Number(sel.value)||0));
  document.querySelectorAll("#f-items input").forEach(function(el){ el.addEventListener("input", recalc); });
  sel.selectedIndex = 0;
  recalc();
}
function readItems(){
  var out = [];
  document.querySelectorAll("#f-items .row").forEach(function(row){
    var desc = row.querySelector(".desc").value.trim();
    var qty = Number(row.querySelector(".qty").value) || 0;
    var amt = cents(row.querySelector(".amt").value);
    if(desc && qty > 0 && amt !== null) out.push({description:desc, quantity:qty, unitCents:amt});
  });
  return out;
}
function recalc(){
  var total = readItems().reduce(function(s,i){ return s + Math.round(i.quantity*i.unitCents); }, 0);
  var el = document.getElementById("f-total");
  if(el) el.textContent = "Total: " + money(total);
}
function clearSide(){
  document.getElementById("side").innerHTML = '<div class="empty">Pick a client on the left to write up their invoice, or an invoice to see its payments.</div>';
}

async function createInvoice(){
  var items = readItems();
  if(!items.length) return toast("Add at least one line item with a description and amount.");
  var minC = cents(document.getElementById("f-min").value);
  var payload = {
    name: document.getElementById("f-name").value.trim(),
    email: document.getElementById("f-email").value.trim(),
    company: document.getElementById("f-company").value.trim(),
    plan: document.getElementById("f-plan").value.trim(),
    items: items,
    dueDate: document.getElementById("f-due").value,
    memo: document.getElementById("f-memo").value.trim(),
    allowPartial: document.getElementById("f-partial").checked,
    minPaymentCents: minC === null ? undefined : minC,
    sheetRow: Number(document.getElementById("f-row").value) || undefined,
    send: document.getElementById("f-send").checked
  };
  try {
    var j = await api("/api/admin/invoices", {method:"POST", body: JSON.stringify(payload)});
    toast("Invoice " + j.invoice.number + " created — " + mailWord(j.mail));
    await Promise.all([loadInvoices(), loadClients()]);
    showTab("invoices");
    var idx = INVOICES.findIndex(function(v){ return v.id === j.invoice.id; });
    if(idx >= 0) pickInvoice(idx);
  } catch(e){ toast("Error: " + e.message); }
}

/* ── Invoice detail ───────────────────────────────────────────── */
function pickInvoice(i){
  var v = INVOICES[i];
  if(!v) return;
  var lines = v.items.map(function(it){
    return '<div>' + esc(it.description) + ' × ' + it.quantity + ' — ' + money(Math.round(it.quantity*it.unitCents)) + '</div>';
  }).join("");
  var pays = v.payments.length
    ? v.payments.map(function(p){
        return '<div>' + esc((p.at||"").slice(0,16).replace("T"," ")) + ' — ' + money(p.amountCents) + ' ' + esc(p.method)
          + (p.feeCents ? ' (+' + money(p.feeCents) + ' fee)' : '')
          + ' <strong>' + esc(p.status) + '</strong>' + (p.note ? ' — ' + esc(p.note) : '') + '</div>';
      }).join("")
    : '<div>No payments yet.</div>';
  document.getElementById("side").innerHTML =
    '<h2>' + esc(v.number) + ' <em>' + esc(v.statusLabel) + '.</em></h2>'
    + '<dl><dt>Client</dt><dd>' + esc(v.name) + (v.company ? ' · ' + esc(v.company) : '') + '</dd>'
    + '<dt>Email</dt><dd>' + esc(v.email) + '</dd>'
    + '<dt>Total</dt><dd>' + money(v.subtotalCents) + '</dd>'
    + '<dt>Paid</dt><dd>' + money(v.paidCents) + '</dd>'
    + '<dt>Balance</dt><dd><strong>' + money(v.balanceCents) + '</strong></dd>'
    + (v.dueDate ? '<dt>Due</dt><dd>' + esc(v.dueDate) + '</dd>' : '')
    + '<dt>Partial pay</dt><dd>' + (v.allowPartial ? 'allowed, min ' + money(v.minPaymentCents) : 'full balance only') + '</dd>'
    + '<dt>Sent</dt><dd>' + (v.sentAt ? esc(v.sentAt.slice(0,16).replace("T"," ")) : 'not yet') + '</dd>'
    + (v.sheetRow ? '<dt>Sheet row</dt><dd>' + v.sheetRow + '</dd>' : '')
    + '</dl>'
    + '<div class="sec">Line items</div><div class="hist">' + lines + '</div>'
    + '<div class="sec">Pay link</div>'
    + '<div class="linkrow"><input type="text" readonly value="' + esc(v.payUrl) + '" onclick="this.select()">'
    + '<button class="ghost small" onclick="copyLink(this)" data-url="' + esc(v.payUrl) + '">Copy</button></div>'
    + '<div class="row" style="margin-top:10px"><button class="ghost" onclick="resend(' + v.id + ')">' + (v.sentAt ? 'Resend' : 'Send') + ' Invoice Email</button></div>'
    + (v.status !== "void" && v.balanceCents > 0
        ? '<div class="sec">Record a cash / check payment</div>'
          + '<div class="hint">No card fee is added to these — it only applies to online card payments.</div>'
          + '<div class="row"><input class="amt" type="text" id="p-amt" value="' + (v.balanceCents/100).toFixed(2) + '" inputmode="decimal">'
          + '<select id="p-method"><option value="cash">Cash</option><option value="check">Check</option><option value="ach">Bank transfer</option><option value="other">Other</option></select>'
          + '<button onclick="recordPayment(' + v.id + ')">Record</button></div>'
          + '<input type="text" id="p-note" placeholder="Note (e.g. check #1042)" style="width:100%">'
        : '')
    + '<div class="sec">Payments</div><div class="hist">' + pays + '</div>'
    + (v.status !== "void" && v.paidCents === 0
        ? '<div class="row" style="margin-top:16px"><button class="danger" onclick="voidInvoice(' + v.id + ')">Void Invoice</button></div>'
        : '');
}

function copyLink(btn){
  var url = btn.getAttribute("data-url");
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(url).then(function(){ toast("Pay link copied"); }, function(){ prompt("Pay link:", url); });
  } else { prompt("Pay link:", url); }
}
async function resend(id){
  try { var j = await api("/api/admin/invoices/" + id + "/send", {method:"POST", body:"{}"}); toast("Invoice " + mailWord(j.mail)); await loadInvoices(); }
  catch(e){ toast("Error: " + e.message); }
}
async function recordPayment(id){
  var amt = cents(document.getElementById("p-amt").value);
  if(amt === null || amt <= 0) return toast("Enter the amount received.");
  var body = {amountCents: amt, method: document.getElementById("p-method").value, note: document.getElementById("p-note").value};
  try {
    var j = await api("/api/admin/invoices/" + id + "/payments", {method:"POST", body: JSON.stringify(body)});
    toast("Recorded " + money(amt) + " — balance now " + money(j.invoice.balanceCents));
    await Promise.all([loadInvoices(), loadClients()]);
    var idx = INVOICES.findIndex(function(v){ return v.id === id; });
    if(idx >= 0) pickInvoice(idx);
  } catch(e){ toast("Error: " + e.message); }
}
async function voidInvoice(id){
  if(!confirm("Void this invoice? The client's pay link will stop asking for money.")) return;
  try { await api("/api/admin/invoices/" + id + "/void", {method:"POST", body:"{}"}); toast("Invoice voided"); await Promise.all([loadInvoices(), loadClients()]); clearSide(); }
  catch(e){ toast("Error: " + e.message); }
}

loadClients();
loadInvoices();
</script>
</body>
</html>`;
