/*
 * Stripe payments for room bookings.
 * ----------------------------------
 * Bookings are PAY-FIRST: nothing reaches the Google Calendar until Stripe says
 * the money cleared. Three routes make that safe:
 *
 *   POST /api/book/checkout      validate → hold the slot → Stripe Checkout URL
 *   POST /api/stripe/webhook     Stripe tells us it's paid → create the booking
 *   GET  /api/book/session/:id   the return page asks "am I confirmed yet?"
 *
 * ── Why a hold table ──────────────────────────────────────────────────────
 * Between "clicked Reserve" and "payment cleared" the slot belongs to nobody.
 * Without a hold, two people could each pay for the same Tuesday 10:00 AM
 * conference room and one of them would have to be refunded and apologised to.
 * So checkout writes a `pending` row that reads as busy, expiring with the
 * Stripe session (CHECKOUT_TTL_MINUTES) so an abandoned cart frees the slot.
 *
 * ── Why the webhook isn't the only path ───────────────────────────────────
 * Webhooks can be delayed, misconfigured, or lost. "Customer paid, no booking
 * exists" is the worst outcome here, so the return page reconciles too: it asks
 * Stripe directly whether the session is paid and finishes the job if the
 * webhook hasn't. Both paths funnel through the same idempotent confirm().
 *
 * ── Trust ─────────────────────────────────────────────────────────────────
 * The browser never sends a price. It sends what it wants to book; the server
 * looks up the rate, verifies member status against the members table, and
 * computes the amount itself. Anything else is a discount code anyone can type.
 */
import type { Express, Request, Response } from "express";
import express from "express";
import Stripe from "stripe";
import type { Database } from "better-sqlite3";
import { getDb, nowIso } from "./db.js";
import { verifyMember, deskworksLookupConfigured } from "./memberLookup.js";
import { cardFeePercent } from "./cardFee.js";
import { cardFeeCents } from "../shared/billing.js";
import {
  findSpace,
  formatMinutes,
  hoursToMinutes,
  parseTimeToMinutes,
  priceFor,
  validateBookingWindow,
  isTour,
  type Space,
} from "../shared/booking.js";

/** How long a slot stays held while the customer is in Stripe Checkout. */
const CHECKOUT_TTL_MINUTES = 30;

const CURRENCY = "usd";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ── Stripe client ────────────────────────────────────────────────────── */
let stripeClient: Stripe | null = null;

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!stripeClient) stripeClient = new Stripe(key);
  return stripeClient;
}

/** True once Stripe is configured well enough to take a payment. */
export function paymentsConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/* ── Member verification ──────────────────────────────────────────────── */
/*
 * "I am a member" is a claim, not evidence — with money attached it's a
 * discount anyone could click. The member rate is granted only when the email
 * checks out against Deskworks or the local members table; see memberLookup.ts.
 */

/* ── Holds ────────────────────────────────────────────────────────────── */
export interface HoldRow {
  id: number;
  session_id: string;
  payment_intent: string | null;
  status: "pending" | "paid" | "expired" | "cancelled";
  space_id: string;
  space_name: string;
  start_iso: string;
  end_iso: string;
  date_str: string;
  start_time: string;
  hours: number;
  name: string;
  email: string;
  phone: string | null;
  notes: string | null;
  is_member: number;
  amount_cents: number;
  fee_cents: number;
  calendar_event_id: string | null;
  expires_at: string;
}

/**
 * Holds that still block a slot: paid ones always, pending ones until they
 * expire. Returned as instants so callers can overlap-test them exactly like
 * calendar events.
 */
export function blockingHolds(
  spaceId: string,
  fromIso: string,
  toIso: string,
): { start: Date; end: Date }[] {
  const db = getDb();
  if (!db) return [];
  try {
    const rows = db
      .prepare(
        `SELECT start_iso, end_iso FROM booking_holds
          WHERE space_id = ?
            AND start_iso < ?
            AND end_iso > ?
            AND ( status = 'paid'
                  OR (status = 'pending' AND expires_at > ?) )`,
      )
      .all(spaceId, toIso, fromIso, nowIso()) as { start_iso: string; end_iso: string }[];
    return rows.map((r) => ({ start: new Date(r.start_iso), end: new Date(r.end_iso) }));
  } catch {
    return [];
  }
}

/**
 * A paid hold already has its calendar event, so it is ALSO on the calendar and
 * would be counted twice by a caller that merges both sources. That's harmless
 * for conflict checks (busy is busy) but would double-render the availability
 * strip, so availability asks only for the pending ones.
 */
export function pendingHolds(
  spaceId: string,
  fromIso: string,
  toIso: string,
): { start: Date; end: Date }[] {
  const db = getDb();
  if (!db) return [];
  try {
    const rows = db
      .prepare(
        `SELECT start_iso, end_iso FROM booking_holds
          WHERE space_id = ? AND status = 'pending'
            AND expires_at > ? AND start_iso < ? AND end_iso > ?`,
      )
      .all(spaceId, nowIso(), toIso, fromIso) as { start_iso: string; end_iso: string }[];
    return rows.map((r) => ({ start: new Date(r.start_iso), end: new Date(r.end_iso) }));
  } catch {
    return [];
  }
}

function holdBySession(db: Database, sessionId: string): HoldRow | undefined {
  return db.prepare("SELECT * FROM booking_holds WHERE session_id = ?").get(sessionId) as
    | HoldRow
    | undefined;
}

/* ── What the caller has to give us ───────────────────────────────────── */
export interface ConfirmedBooking {
  name: string;
  email: string;
  phone?: string;
  notes?: string;
  space: Space;
  dateStr: string;
  startTime: string;
  hours: number;
  startInstant: Date;
  endInstant: Date;
  amountCents: number;
  /** Card surcharge charged on top of amountCents (0 when the fee is off). */
  feeCents: number;
  isMember: boolean;
}

export interface PaymentDeps {
  /** Writes the event to Google Calendar and sends the confirmation emails. */
  createCalendarBooking: (b: ConfirmedBooking) => Promise<{ eventId: string; htmlLink: string }>;
  /** True when something already occupies this space in this window. */
  hasConflict: (spaceId: string, startIso: string, endIso: string) => Promise<boolean>;
  /** Office-local wall time → UTC instant. */
  wallToInstant: (dateStr: string, hour: number, minute: number) => Date;
  /**
   * Invoice payments ride the SAME Stripe webhook endpoint — Stripe sends every
   * event for the account to one URL, so this router dispatches on
   * metadata.kind rather than each feature registering its own endpoint.
   * Injected (rather than imported) so payments stay unaware of invoicing.
   */
  invoicePayments?: {
    credit: (session: Stripe.Checkout.Session) => Promise<void>;
    expire: (session: Stripe.Checkout.Session) => Promise<void>;
  };
}

/** Sessions tagged this way belong to an invoice, not a room booking. */
const INVOICE_KIND = "invoice_payment";
const isInvoiceSession = (s: Stripe.Checkout.Session) => s.metadata?.kind === INVOICE_KIND;

/* ── Confirmation (idempotent) ────────────────────────────────────────── */
/**
 * Turn a paid hold into a real booking. Safe to call repeatedly: Stripe retries
 * webhooks and the return page races them, so this is reached more than once
 * for a single payment on a perfectly normal day.
 */
async function confirmHold(
  db: Database,
  hold: HoldRow,
  deps: PaymentDeps,
  paymentIntent: string | null,
): Promise<{ eventId: string | null; alreadyDone: boolean }> {
  if (hold.calendar_event_id) {
    return { eventId: hold.calendar_event_id, alreadyDone: true };
  }

  const space = findSpace(hold.space_id);
  if (!space) throw new Error(`hold ${hold.session_id} names unknown space "${hold.space_id}"`);

  const created = await deps.createCalendarBooking({
    name: hold.name,
    email: hold.email,
    phone: hold.phone || undefined,
    notes: hold.notes || undefined,
    space,
    dateStr: hold.date_str,
    startTime: hold.start_time,
    hours: hold.hours,
    startInstant: new Date(hold.start_iso),
    endInstant: new Date(hold.end_iso),
    amountCents: hold.amount_cents,
    feeCents: hold.fee_cents || 0,
    isMember: Boolean(hold.is_member),
  });

  db.prepare(
    `UPDATE booking_holds
        SET status = 'paid', calendar_event_id = ?, payment_intent = COALESCE(?, payment_intent),
            updated_at = ?
      WHERE id = ?`,
  ).run(created.eventId, paymentIntent, nowIso(), hold.id);

  console.log(
    `booking paid: ${hold.space_id} ${hold.date_str} ${hold.start_time} ` +
      `($${(hold.amount_cents / 100).toFixed(2)}) → event ${created.eventId}`,
  );
  return { eventId: created.eventId, alreadyDone: false };
}

/* ── Routes ───────────────────────────────────────────────────────────── */
export function mountBookingPayments(app: Express, deps: PaymentDeps) {
  /*
   * The webhook needs the RAW body to verify Stripe's signature — a parsed and
   * re-serialised body produces different bytes and every signature fails. This
   * route therefore brings its own raw parser and must be mounted before any
   * global express.json().
   */
  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    async (req: Request, res: Response) => {
      const stripe = getStripe();
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!stripe || !secret) return res.status(503).send("stripe not configured");

      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(
          req.body as Buffer,
          String(req.headers["stripe-signature"] || ""),
          secret,
        );
      } catch (e: any) {
        // An unverified body is not from Stripe. Never act on it.
        console.error("stripe webhook: bad signature —", e?.message);
        return res.status(400).send(`Webhook Error: ${e?.message}`);
      }

      const db = getDb();
      if (!db) {
        console.error("stripe webhook: no database, cannot confirm booking");
        return res.status(503).send("no database");
      }

      try {
        if (event.type === "checkout.session.completed") {
          const session = event.data.object as Stripe.Checkout.Session;
          // `complete` + unpaid happens with delayed payment methods; wait for
          // checkout.session.async_payment_succeeded rather than booking early.
          if (session.payment_status !== "paid") {
            console.log(`stripe webhook: session ${session.id} complete but unpaid — waiting`);
          } else if (isInvoiceSession(session)) {
            await deps.invoicePayments?.credit(session);
          } else {
            const hold = holdBySession(db, session.id);
            if (hold) {
              await confirmHold(db, hold, deps, String(session.payment_intent || "") || null);
            } else {
              console.warn(`stripe webhook: no hold for session ${session.id}`);
            }
          }
        } else if (event.type === "checkout.session.async_payment_succeeded") {
          const session = event.data.object as Stripe.Checkout.Session;
          if (isInvoiceSession(session)) {
            await deps.invoicePayments?.credit(session);
          } else {
            const hold = holdBySession(db, session.id);
            if (hold) await confirmHold(db, hold, deps, String(session.payment_intent || "") || null);
          }
        } else if (
          event.type === "checkout.session.expired" ||
          event.type === "checkout.session.async_payment_failed"
        ) {
          const session = event.data.object as Stripe.Checkout.Session;
          if (isInvoiceSession(session)) {
            // The attempt is dead; the invoice balance was never touched.
            await deps.invoicePayments?.expire(session);
          } else {
            // Release the slot: they never paid, so it goes back on sale.
            db.prepare(
              `UPDATE booking_holds SET status = 'expired', updated_at = ?
                WHERE session_id = ? AND status = 'pending'`,
            ).run(nowIso(), session.id);
          }
        }
      } catch (e: any) {
        // 500 makes Stripe retry, which is what we want for a transient failure
        // (Calendar API hiccup). The money is taken; the booking must follow.
        console.error(`stripe webhook: handling ${event.type} failed —`, e?.message);
        return res.status(500).send("handler failed");
      }

      res.json({ received: true });
    },
  );

  /* ── Authoritative quote ────────────────────────────────────────────── */
  /*
   * What this booking will ACTUALLY cost, decided the same way checkout decides
   * it. The form calls this once an email is entered so the price on screen is
   * the price on the Stripe page — otherwise someone ticks "Member", sees
   * $30/hr, and gets a $75/hr checkout, which reads as a bait and switch.
   */
  app.get("/api/book/quote", express.json(), async (req: Request, res: Response) => {
    const space = findSpace(String(req.query.space || ""));
    if (!space) return res.status(400).json({ error: "Unknown space." });
    const hours = Number(req.query.hours);
    if (!Number.isFinite(hours) || hours <= 0) {
      return res.status(400).json({ error: "Invalid duration." });
    }
    const email = String(req.query.email || "");
    const member = EMAIL_RE.test(email) ? (await verifyMember(email)).member : false;
    const amount = priceFor(space, hours, member);
    // Quoted in cents so the surcharge rounds exactly once, the same way checkout
    // rounds it — a fee computed twice from dollars can differ by a cent.
    const feeCents = cardFeeCents(amount * 100, cardFeePercent());
    res.json({
      amount,
      rate: member ? space.memberPrice : space.nonMemberPrice,
      member,
      free: amount <= 0,
      feePercent: cardFeePercent(),
      fee: feeCents / 100,
      total: amount + feeCents / 100,
    });
  });

  /* ── "I am a member" ────────────────────────────────────────────────── */
  /*
   * Backs the member step on the booking form. Answers only "does this email
   * get the member rate", never anything about the person behind it — the
   * response is the same shape whether they're a member or a stranger.
   */
  app.get("/api/book/member-check", express.json(), async (req: Request, res: Response) => {
    const email = String(req.query.email || "").trim();
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }
    try {
      const result = await verifyMember(email);
      res.json({
        member: result.member,
        // Which system recognised them, so staff can tell a Deskworks member
        // from one onboarded here when someone calls to query their rate.
        source: result.source,
        deskworksAvailable: deskworksLookupConfigured(),
      });
    } catch (e: any) {
      console.error("member-check failed:", e?.message);
      res.status(502).json({ error: "We couldn't check that just now. Please try again." });
    }
  });

  /* ── Start checkout ─────────────────────────────────────────────────── */
  app.post("/api/book/checkout", express.json(), async (req: Request, res: Response) => {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({ error: "Online payment isn't set up yet. Please call us to book." });
    }
    const db = getDb();
    if (!db) {
      // Without the hold table we can't stop double-payment or record what was
      // bought. Refusing is the honest failure; taking money is not.
      return res.status(503).json({ error: "Booking is temporarily unavailable. Please call us." });
    }

    const { name, email, phone, space, date, startTime, hours, notes } = req.body || {};
    if (!name || !email || !space || !date || !startTime || !hours) {
      return res.status(400).json({ error: "Missing required booking fields." });
    }
    if (String(name).length > 120 || !EMAIL_RE.test(String(email))) {
      return res.status(400).json({ error: "Please provide a valid name and email." });
    }
    const booked = findSpace(String(space));
    if (!booked) return res.status(400).json({ error: "Unknown space." });

    const nHours = Number(hours);
    const windowError = validateBookingWindow(booked, String(date), String(startTime), nHours);
    if (windowError) return res.status(400).json({ error: windowError });

    // Price is OURS to decide. The client sends no amount, and the member rate
    // is granted only against the members table.
    const member = (await verifyMember(String(email))).member;
    const amount = priceFor(booked, nHours, member);
    const amountCents = amount * 100;
    // Charged on top of the room, as its own line — never folded into the rate,
    // so the customer can see what the room cost and what the card cost.
    const feeCents = cardFeeCents(amountCents, cardFeePercent());
    if (amount <= 0) {
      // Tours and anything else free never touch Stripe.
      return res.status(400).json({ error: "That booking is free — no payment needed.", free: true });
    }

    const startMinutes = parseTimeToMinutes(String(startTime));
    const startInstant = deps.wallToInstant(
      String(date),
      Math.floor(startMinutes / 60),
      startMinutes % 60,
    );
    if (startInstant.getTime() < Date.now() - 60_000) {
      return res.status(400).json({ error: "That date has already passed." });
    }
    const endInstant = new Date(startInstant.getTime() + hoursToMinutes(nHours) * 60_000);

    // Check the calendar AND the live holds before sending anyone to pay —
    // taking money for a slot that's already gone is the failure to avoid.
    try {
      if (await deps.hasConflict(booked.id, startInstant.toISOString(), endInstant.toISOString())) {
        return res.status(409).json({ error: "That time was just booked. Please pick another slot." });
      }
    } catch (e: any) {
      console.error("checkout conflict check failed:", e?.message);
      return res.status(502).json({ error: "Could not check availability. Please try again." });
    }

    const expiresAt = new Date(Date.now() + CHECKOUT_TTL_MINUTES * 60_000);
    const origin =
      process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "") ||
      `${req.protocol}://${req.get("host")}`;
    const dateLabel = String(date);
    const endTime = formatMinutes(startMinutes + hoursToMinutes(nHours));

    try {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: String(email),
        // Stripe releases its own session at the same moment our hold lapses,
        // so a customer can never pay against a slot we've already put back.
        expires_at: Math.floor(expiresAt.getTime() / 1000),
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: CURRENCY,
              unit_amount: amountCents,
              product_data: {
                name: booked.name,
                description:
                  `${dateLabel} · ${String(startTime)}–${endTime} · ` +
                  `${nHours} ${nHours === 1 ? "hour" : "hours"}` +
                  (member ? " · member rate" : ""),
              },
            },
          },
          ...(feeCents > 0
            ? [
                {
                  quantity: 1,
                  price_data: {
                    currency: CURRENCY,
                    unit_amount: feeCents,
                    product_data: {
                      name: `Card processing fee (${cardFeePercent()}%)`,
                      description: "Applies to card payments.",
                    },
                  },
                },
              ]
            : []),
        ],
        // Everything needed to rebuild the booking lives in our own row; this is
        // for reading in the Stripe dashboard when someone asks what a charge was.
        metadata: {
          space: booked.id,
          date: dateLabel,
          startTime: String(startTime),
          hours: String(nHours),
          member: member ? "yes" : "no",
          fee: (feeCents / 100).toFixed(2),
        },
        success_url: `${origin}/booking/confirmed?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/booking?canceled=1`,
      });

      db.prepare(
        `INSERT INTO booking_holds (
           session_id, status, space_id, space_name, start_iso, end_iso, date_str,
           start_time, hours, name, email, phone, notes, is_member, amount_cents,
           fee_cents, expires_at, created_at, updated_at
         ) VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        session.id,
        booked.id,
        booked.name,
        startInstant.toISOString(),
        endInstant.toISOString(),
        dateLabel,
        String(startTime),
        nHours,
        String(name),
        String(email),
        phone ? String(phone) : null,
        notes ? String(notes) : null,
        member ? 1 : 0,
        amountCents,
        feeCents,
        expiresAt.toISOString(),
        nowIso(),
        nowIso(),
      );

      res.json({
        url: session.url,
        sessionId: session.id,
        amount,
        member,
        fee: feeCents / 100,
        total: (amountCents + feeCents) / 100,
      });
    } catch (e: any) {
      console.error("checkout create failed:", e?.message);
      res.status(502).json({ error: "Could not start payment. Please try again or call us." });
    }
  });

  /* ── Did my payment land? ───────────────────────────────────────────── */
  /*
   * The return page calls this. It re-asks Stripe rather than trusting the
   * redirect (anyone can visit /booking/confirmed?session_id=…), and finishes
   * the booking itself if the webhook hasn't arrived — so a webhook that is
   * merely slow, or misconfigured entirely, never leaves someone paid-but-
   * unbooked.
   */
  app.get("/api/book/session/:id", express.json(), async (req: Request, res: Response) => {
    const stripe = getStripe();
    const db = getDb();
    if (!stripe || !db) return res.status(503).json({ error: "Not configured." });

    const sessionId = String(req.params.id || "");
    const hold = holdBySession(db, sessionId);
    if (!hold) return res.status(404).json({ error: "Unknown booking session." });

    if (hold.calendar_event_id) {
      return res.json({ status: "confirmed", booking: publicHold(hold) });
    }

    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId);
    } catch (e: any) {
      console.error("session lookup failed:", e?.message);
      return res.status(502).json({ error: "Could not check the payment status." });
    }

    if (session.payment_status !== "paid") {
      return res.json({ status: session.status === "expired" ? "expired" : "pending" });
    }

    try {
      await confirmHold(db, hold, deps, String(session.payment_intent || "") || null);
      const fresh = holdBySession(db, sessionId)!;
      console.log(`booking reconciled on return (webhook had not arrived): ${sessionId}`);
      return res.json({ status: "confirmed", booking: publicHold(fresh) });
    } catch (e: any) {
      console.error("reconcile failed:", e?.message);
      // They HAVE paid — say so plainly rather than implying the money vanished.
      return res.status(502).json({
        status: "paid_not_booked",
        error:
          "Your payment went through, but we couldn't finish putting it on the calendar. " +
          "Please call us and we'll sort it out right away — you will not be charged twice.",
      });
    }
  });
}

/** The subset of a hold that's safe to hand back to the browser. */
function publicHold(h: HoldRow) {
  return {
    space: h.space_name,
    date: h.date_str,
    startTime: h.start_time,
    hours: h.hours,
    amount: h.amount_cents / 100,
    fee: (h.fee_cents || 0) / 100,
    total: (h.amount_cents + (h.fee_cents || 0)) / 100,
    isMember: Boolean(h.is_member),
    name: h.name,
    email: h.email,
  };
}

/** Exposed so the free-tour path can still tell whether a space needs paying for. */
export { isTour };
