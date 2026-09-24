/**
 * SQLite persistence for the membership-activation pipeline.
 * ----------------------------------------------------------
 * A tiny embedded database (better-sqlite3) that tracks every new member as
 * they move through onboarding (see server/memberPipeline.ts). The DB file
 * lives at DB_PATH (default ./data/jvo-members.db; on Render it points at the
 * mounted persistent disk, /data/jvo-members.db).
 *
 * GRACEFUL DEGRADATION: the rest of the site must keep working without a DB.
 * getDb() lazily opens the database once; if the native module fails to load or
 * the path isn't writable it logs ONE warning and returns null forever after —
 * callers must handle a null return and carry on.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { Database } from "better-sqlite3";

const require = createRequire(import.meta.url);

const DB_PATH = process.env.DB_PATH || "./data/jvo-members.db";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY,
  public_id TEXT UNIQUE,
  status TEXT NOT NULL,
  name TEXT,
  email TEXT,
  phone TEXT,
  business_name TEXT,
  business_address TEXT,
  membership_type TEXT,
  authorized_users TEXT,
  mailing_prefs TEXT,
  portal_token TEXT UNIQUE,
  info_confirmed_at TEXT,
  form1583_downloaded_at TEXT,
  appointment_at TEXT,
  approved_at TEXT,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS member_documents (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id),
  kind TEXT NOT NULL,
  filename TEXT,
  stored_path TEXT,
  mime TEXT,
  size INTEGER,
  uploaded_at TEXT,
  UNIQUE(member_id, kind)
);

CREATE TABLE IF NOT EXISTS member_status_history (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor TEXT,
  note TEXT,
  at TEXT
);

CREATE TABLE IF NOT EXISTS member_email_log (
  id INTEGER PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id),
  kind TEXT NOT NULL,
  to_email TEXT,
  sent_at TEXT,
  UNIQUE(member_id, kind)
);

/*
 * Room bookings that are mid-payment.
 *
 * Bookings are pay-first: nothing reaches the Google Calendar until Stripe
 * confirms the money. That leaves a gap between "customer clicked Reserve" and
 * "payment cleared" in which the slot is committed to nobody — so we write a
 * row here first and treat live 'pending' rows as busy. Without it two people
 * could each pay for the same 10:00 AM Tuesday conference room.
 *
 * A row is the durable record of a paid booking too: calendar_event_id is set
 * once the event exists, which is also what makes webhook delivery idempotent
 * (Stripe retries, and may deliver the same event more than once).
 */
CREATE TABLE IF NOT EXISTS booking_holds (
  id INTEGER PRIMARY KEY,
  session_id TEXT UNIQUE NOT NULL,
  payment_intent TEXT,
  status TEXT NOT NULL,            -- pending | paid | expired | cancelled
  space_id TEXT NOT NULL,
  space_name TEXT,
  start_iso TEXT NOT NULL,         -- UTC instant
  end_iso TEXT NOT NULL,           -- UTC instant
  date_str TEXT,                   -- YYYY-MM-DD, office-local
  start_time TEXT,                 -- "9:30 AM", office-local
  hours REAL,
  name TEXT,
  email TEXT,
  phone TEXT,
  notes TEXT,
  is_member INTEGER DEFAULT 0,
  amount_cents INTEGER,            -- the room charge itself
  fee_cents INTEGER DEFAULT 0,     -- card surcharge, charged on top (see cardFee.ts)
  calendar_event_id TEXT,
  expires_at TEXT,                 -- ISO; after this a pending row stops blocking
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_holds_status_space ON booking_holds(status, space_id);
CREATE INDEX IF NOT EXISTS idx_holds_window ON booking_holds(start_iso, end_iso);

/*
 * Membership invoices, written up from the client master list (see
 * server/invoices.ts and server/clientSheet.ts).
 *
 * The invoice — not Stripe — is the record of what is owed. Stripe is only how
 * money arrives, and it may arrive in several goes: invoices support PARTIAL
 * payment, so the balance is the subtotal minus every payment credited against
 * it. The token column is the unguessable half of the customer's pay link.
 */
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  number TEXT UNIQUE NOT NULL,       -- JVO-2026-0001, shown to the customer
  token TEXT UNIQUE NOT NULL,        -- pay-link secret: /invoice/<token>
  status TEXT NOT NULL,              -- open | partial | paid | void
  name TEXT,
  email TEXT,
  company TEXT,
  phone TEXT,
  plan TEXT,
  line_items TEXT NOT NULL,          -- JSON [{description, quantity, unitCents}]
  subtotal_cents INTEGER NOT NULL,
  allow_partial INTEGER DEFAULT 1,   -- may they pay it in instalments?
  min_payment_cents INTEGER DEFAULT 0,
  due_date TEXT,                     -- YYYY-MM-DD, office-local
  memo TEXT,                         -- shown to the customer
  staff_notes TEXT,                  -- never shown to the customer
  sheet_row INTEGER,                 -- master-list row this was written up from
  sent_at TEXT,
  paid_at TEXT,
  created_at TEXT,
  updated_at TEXT
);

/*
 * One row per payment attempt against an invoice.
 *
 * amount_cents is what comes off the balance. fee_cents is the 3% card
 * surcharge, charged ON TOP and deliberately NOT credited — a customer paying
 * $199 by card is charged $204.97 and still owes nothing, while the same $199
 * in cash carries no fee. Offline payments (cash, check) have no session_id.
 */
CREATE TABLE IF NOT EXISTS invoice_payments (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  session_id TEXT UNIQUE,            -- Stripe Checkout session; null when offline
  payment_intent TEXT,
  method TEXT NOT NULL,              -- card | cash | check | ach | other
  status TEXT NOT NULL,              -- pending | paid | expired
  amount_cents INTEGER NOT NULL,     -- applied to the balance
  fee_cents INTEGER DEFAULT 0,       -- card surcharge, on top of the above
  note TEXT,
  created_at TEXT,
  paid_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_email ON invoices(email);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id);

CREATE INDEX IF NOT EXISTS idx_members_status ON members(status);
CREATE INDEX IF NOT EXISTS idx_member_docs_member ON member_documents(member_id);
CREATE INDEX IF NOT EXISTS idx_member_history_member ON member_status_history(member_id);
CREATE INDEX IF NOT EXISTS idx_member_email_member ON member_email_log(member_id);
`;

let db: Database | null = null;
let failed = false;

/**
 * Lazy singleton. Returns the open Database, or null when SQLite isn't
 * available (missing native module, read-only filesystem, …). Warns once.
 */
export function getDb(): Database | null {
  if (db) return db;
  if (failed) return null;
  try {
    const BetterSqlite3 = require("better-sqlite3");
    fs.mkdirSync(path.dirname(path.resolve(DB_PATH)), { recursive: true });
    const opened: Database = new BetterSqlite3(DB_PATH);
    opened.pragma("journal_mode = WAL");
    opened.pragma("foreign_keys = ON");
    opened.exec(SCHEMA);
    migrate(opened);
    db = opened;
    console.log(`[db] SQLite open at ${path.resolve(DB_PATH)}`);
    return db;
  } catch (err: any) {
    failed = true;
    console.warn(
      `[db] SQLite unavailable (${err?.message}) — membership pipeline persistence disabled; the site will keep working without it.`
    );
    return null;
  }
}

/**
 * Columns added after a table shipped.
 *
 * CREATE TABLE IF NOT EXISTS does nothing to a table that already exists, so a
 * database created before a column was added never gains it — on Render that's
 * the live booking history sitting on the persistent disk. Each entry is applied
 * only when the column is genuinely absent, so this is safe to run on every open.
 */
const ADDED_COLUMNS: { table: string; column: string; definition: string }[] = [
  { table: "booking_holds", column: "fee_cents", definition: "INTEGER DEFAULT 0" },
];

function migrate(open: Database): void {
  for (const { table, column, definition } of ADDED_COLUMNS) {
    try {
      const cols = open.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (!cols.length || cols.some((c) => c.name === column)) continue;
      open.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      console.log(`[db] added ${table}.${column}`);
    } catch (err: any) {
      // A failed migration must not take the site down; the feature that needs
      // the column degrades instead.
      console.warn(`[db] could not add ${table}.${column} — ${err?.message}`);
    }
  }
}

/** Current time as an ISO-8601 string (UTC) — the stamp format used everywhere. */
export function nowIso(): string {
  return new Date().toISOString();
}
